/**
 * 站内角色搜索的纯逻辑（T-20261104b，契约 5.5 SearchEndpoints.suggest / results）。不依赖 React，单元测试直接跑。
 *
 * - 输入分四种：空白、只有一个字、正常（2～64 字）、超长。只有「正常」才允许显示联网查找（收费）入口；
 *   一个字、空白、超长都只在站内搜，不弹收费提示。
 * - 防抖与请求闸门：同一时间只认最后一次输入；账号切换（owner 变化）、换了搜索词以后，迟到的旧响应一律丢弃；
 *   断网 / 失败只报错，不清掉上一次的结果。
 * - 结果项点击去哪：只用服务器给的 ID 走现有页面，添加闸门与作品可见性在那里重新核对。
 */
import {
  SITE_SEARCH_QUERY_MAX_CHARS,
  type SiteSearchResult,
  type SiteSearchSuggestion,
} from '@weiban/contracts';

/** 边输入边联想的防抖（毫秒）。 */
export const SITE_SEARCH_DEBOUNCE_MS = 250;

export type SiteQueryMode = 'empty' | 'single' | 'normal' | 'too_long';

export function siteQueryMode(raw: string): SiteQueryMode {
  const chars = Array.from(raw.trim()).length;
  if (!chars) return 'empty';
  if (chars === 1) return 'single';
  return chars > SITE_SEARCH_QUERY_MAX_CHARS ? 'too_long' : 'normal';
}

/** 联网查找（收费）入口只给 2～64 字的搜索词。 */
export function allowWebSearch(raw: string): boolean {
  return siteQueryMode(raw) === 'normal';
}

type Action = SiteSearchResult['action'];
type Source = SiteSearchResult['source'];

/** 点击结果去哪；不认识的动作（接收端容错读成 unsupported）退回作品页 / 资料页。 */
export function siteResultHref(item: SiteSearchResult): string | null {
  const character = item.characterId ? `/characters/${item.characterId}` : null;
  const work = item.workId ? `/plaza/works/${item.workId}` : null;
  switch (item.action) {
    case 'chat':
      return item.conversationId ? `/chat/${item.conversationId}` : (character ?? work);
    case 'add':
    case 'open_own':
      return character ?? work;
    case 'view_work':
      return work ?? character;
    default:
      return item.source === 'plaza' ? (work ?? character) : (character ?? work);
  }
}

const ACTION_LABELS: Record<Exclude<Action, 'unsupported'>, string> = {
  add: '添加',
  view_work: '看作品',
  chat: '去聊天',
  open_own: '我的角色',
};

export function siteActionLabel(action: Action): string {
  return action === 'unsupported' ? '查看' : ACTION_LABELS[action];
}

const SOURCE_LABELS: Record<Exclude<Source, 'unsupported'>, string> = {
  official: '微伴角色',
  plaza: '广场作品',
  own: '我的角色',
};

export function siteSourceLabel(source: Source): string {
  return source === 'unsupported' ? '其他' : SOURCE_LABELS[source];
}

/** 结果第二行：身份说明；同名多项又查不到可靠区别时写「暂未核实身份」，不编履历。 */
export function siteIdentityText(item: SiteSearchResult): string | null {
  if (item.identity) return item.identity;
  return item.unverified && item.ambiguous ? '暂未核实身份' : null;
}

/** 联想行的补充说明：命中的是别名 / 代表作品 / 基于的角色时写出来。 */
export function siteSuggestionNote(item: SiteSearchSuggestion): string | null {
  const term = item.matchedTerm;
  if (!term) return null;
  if (term.kind === 'alias') return `别名：${term.text}`;
  if (term.kind === 'keyword') return `相关：${term.text}`;
  if (term.kind === 'based_on') return `基于：${term.text}`;
  return term.text;
}

/**
 * 请求闸门：begin 记下这次请求属于哪个账号、哪个搜索词，accept 只认最后一次、且账号与搜索词都没变的那次。
 * 换账号时调用 reset，在途的全部作废。
 */
export class RequestGate {
  private ordinal = 0;
  private current: { ordinal: number; owner: string; key: string } | null = null;

  begin(owner: string, key: string): number {
    this.ordinal += 1;
    this.current = { ordinal: this.ordinal, owner, key };
    return this.ordinal;
  }

  accept(ticket: number, owner: string, key: string): boolean {
    const c = this.current;
    return !!c && c.ordinal === ticket && c.owner === owner && c.key === key;
  }

  reset(): void {
    this.ordinal += 1;
    this.current = null;
  }
}

export interface SuggestState<T> {
  /** 当前（最后一次）请求的搜索词。 */
  key: string;
  /** data 对应的搜索词：换词后、新结果回来前先留着上一批（少闪一下），失败时只保留同一个词的结果。 */
  dataKey: string;
  data: T | null;
  loading: boolean;
  error: string;
}

const EMPTY = { key: '', dataKey: '', data: null, loading: false, error: '' } as const;

type Timer = ReturnType<typeof setTimeout>;

/**
 * 边输入边联想的控制器：防抖、只认最后一次、换账号作废、失败保留上次结果。
 * fetch 由调用方给（网页里是 api.call(SearchEndpoints.suggest)），onChange 拿到新状态去 setState。
 */
export class SuggestRunner<T> {
  private readonly gate = new RequestGate();
  private timer: Timer | null = null;
  private owner = '';
  private state: SuggestState<T> = { ...EMPTY };

  constructor(
    private readonly options: {
      delay: number;
      fetch: (q: string) => Promise<T>;
      onChange: (state: SuggestState<T>) => void;
      describeError: (error: unknown) => string;
      setTimer?: (fn: () => void, ms: number) => Timer;
      clearTimer?: (timer: Timer) => void;
    },
  ) {}

  private emit(next: SuggestState<T>) {
    this.state = next;
    this.options.onChange(next);
  }

  private cancelTimer() {
    if (this.timer !== null) (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = null;
  }

  /** 输入变化：空白立刻清空；其余等防抖后再请求。owner 变化时在途请求作废、旧结果清空。 */
  update(owner: string, raw: string): void {
    const key = raw.trim();
    if (owner !== this.owner) {
      this.owner = owner;
      this.gate.reset();
      this.state = { ...EMPTY };
    }
    this.cancelTimer();
    if (siteQueryMode(key) === 'empty') {
      this.gate.reset();
      this.emit({ ...EMPTY });
      return;
    }
    if (key === this.state.key && (this.state.loading || this.state.dataKey === key)) return;
    this.timer = (this.options.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.run(owner, key);
    }, this.options.delay);
  }

  private async run(owner: string, key: string) {
    const ticket = this.gate.begin(owner, key);
    const previous = this.state;
    this.emit({ ...previous, key, loading: true, error: '' });
    try {
      const data = await this.options.fetch(key);
      if (!this.gate.accept(ticket, owner, key)) return;
      this.emit({ key, dataKey: key, data, loading: false, error: '' });
    } catch (error) {
      if (!this.gate.accept(ticket, owner, key)) return;
      // 断网 / 失败：只报错；同一个词上一次的结果留着，别的词的旧结果清掉。
      const same = this.state.dataKey === key;
      this.emit({
        key,
        dataKey: same ? key : '',
        data: same ? this.state.data : null,
        loading: false,
        error: this.options.describeError(error),
      });
    }
  }

  dispose(): void {
    this.cancelTimer();
    this.gate.reset();
  }
}

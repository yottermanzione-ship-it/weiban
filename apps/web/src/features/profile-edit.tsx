/*
 * 个人信息各项的编辑页（10-21 G2）：原来的底部抽屉改成整页推入的二级页面，细节对照微信截图 28–35。
 * 路由：/profile/nickname、/profile/gender、/profile/birthday、/profile/region(/:group)、/profile/about、
 *       /profile/alias（微伴号说明页）、/profile/alias/edit（修改微伴号）、/profile/nudge（拍一拍，3.27）。
 */
import { ApiFailure } from '@weiban/client-core';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IdentityEndpoints, Username, type Profile } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { REGION_GROUPS, nearestRegion } from '../data/regions.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import {
  ClearInput,
  CountTextarea,
  EditPage,
  FormPage,
  InfoPage,
  PickRow,
  SubPageLayer,
  useDraft,
} from './edit-page.js';
import { OldIcon } from './old-icons.js';
import { MenuRow, NavBar, SyncPendingState, useBack } from './shell-kit.js';
import { DateField } from './wheel-picker.js';

const FALLBACK = '/profile';

/**
 * 资料读到之前先显示同样的顶栏（完成灰色）和空白，避免整页闪一下加载图标；
 * 读到后才挂编辑器，草稿只取第一次的值。
 */
function WithProfile({ title, children }: { title: string; children(p: Profile): ReactNode }) {
  const remote = useRemote(IdentityEndpoints.getProfile);
  if (!remote.data)
    return (
      <EditPage title={title} canSave={false} onSave={() => {}} fallback={FALLBACK}>
        {remote.error && (
          <p role="alert" className="notice-bar">
            {remote.error}
          </p>
        )}
      </EditPage>
    );
  return <>{children(remote.data)}</>;
}

function useOwner() {
  const auth = useAuth();
  return () => {
    const owner = auth.session
      ? { userId: auth.session.user.userId, sessionId: auth.session.session.sessionId }
      : null;
    if (!owner || !api.owns(owner)) throw new ApiFailure('session_changed', '登录状态已改变', 0);
    return owner;
  };
}

/** 保存资料：成功后刷新账号信息并返回上一页（微信不弹「已保存」）。 */
function useProfileSave(steps = 1) {
  const auth = useAuth();
  const owner = useOwner();
  const navigate = useNavigate();
  const back = useBack(FALLBACK);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save(body: Partial<Profile>) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const who = owner();
      await api.call(IdentityEndpoints.updateProfile, { body });
      if (!api.owns(who)) return;
      await auth.refreshUser();
      if (!api.owns(who)) return;
      window.dispatchEvent(new Event('weiban:settings-updated'));
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (steps > 1 && idx >= steps) navigate(-steps);
      else if (steps > 1) navigate(FALLBACK, { replace: true });
      else back();
    } catch (e) {
      setError(friendlyError(e));
      setPending(false);
    }
  }
  return { pending, error, save };
}

function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error page-note">
      {error}
    </p>
  ) : null;
}

// ---------- 昵称 ----------

export function ProfileNicknamePage() {
  return (
    <WithProfile title="设置昵称">
      {(profile) => <NicknameEditor initial={profile.nickname ?? ''} />}
    </WithProfile>
  );
}
function NicknameEditor({ initial }: { initial: string }) {
  const draft = useDraft(initial);
  const { pending, error, save } = useProfileSave();
  const canSave = draft.changed && draft.value.trim() !== '';
  const submit = () => {
    if (canSave) void save({ nickname: draft.value.trim() });
  };
  return (
    <EditPage
      title="设置昵称"
      canSave={canSave}
      pending={pending}
      onSave={submit}
      fallback={FALLBACK}
    >
      <ClearInput
        label="昵称"
        value={draft.value}
        maxLength={20}
        disabled={pending}
        onChange={draft.setValue}
        onEnter={submit}
      />
      <ErrorLine error={error} />
    </EditPage>
  );
}

// ---------- 性别 ----------

const genderOptions = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
] as const;

export function ProfileGenderPage() {
  return (
    <WithProfile title="设置性别">
      {(profile) => <GenderEditor initial={profile.gender} />}
    </WithProfile>
  );
}
function GenderEditor({ initial }: { initial: Profile['gender'] }) {
  const [value, setValue] = useState(initial);
  const { pending, error, save } = useProfileSave();
  return (
    <EditPage
      title="设置性别"
      canSave={value !== initial && value !== 'unspecified'}
      pending={pending}
      onSave={() => void save({ gender: value })}
      fallback={FALLBACK}
    >
      <div className="edit-group" role="radiogroup" aria-label="性别">
        {genderOptions.map((option) => (
          <PickRow
            key={option.value}
            label={option.label}
            checked={value === option.value}
            disabled={pending}
            onClick={() => setValue(option.value)}
          />
        ))}
      </div>
      <ErrorLine error={error} />
    </EditPage>
  );
}

// ---------- 生日 ----------

export function ProfileBirthdayPage() {
  return (
    <WithProfile title="设置生日">
      {(profile) => <BirthdayEditor initial={profile.birthday ?? ''} />}
    </WithProfile>
  );
}
function BirthdayEditor({ initial }: { initial: string }) {
  const draft = useDraft(initial);
  const { pending, error, save } = useProfileSave();
  const today = new Date().toLocaleDateString('sv-SE');
  return (
    <EditPage
      title="设置生日"
      canSave={draft.changed}
      pending={pending}
      onSave={() => void save({ birthday: draft.value || null })}
      fallback={FALLBACK}
    >
      {/* U2：原生日期框换成微信式日期滚轮 */}
      <div className="edit-input-row">
        <DateField
          title="生日"
          label="生日"
          value={draft.value}
          max={today}
          placeholder="未填写"
          clearable
          clearLabel="清除生日"
          disabled={pending}
          onChange={draft.setValue}
        />
      </div>
      <p className="edit-hint">
        {today && draft.value > today ? '生日不能晚于今天' : 'TA 会在你生日那天记得你'}
      </p>
      <ErrorLine error={error} />
    </EditPage>
  );
}

// ---------- 地区 ----------

type Locate =
  | { state: 'idle' }
  | { state: 'locating' }
  | { state: 'found'; region: string }
  | { state: 'none' }
  | { state: 'failed' };

export function ProfileRegionPage() {
  return (
    <WithProfile title="设置地区">
      {(profile) => <RegionEditor initial={profile.city ?? ''} />}
    </WithProfile>
  );
}
/** 定位到的地区（资料页地区二级页与首次填写资料共用，U5 抽出）。 */
function useRegionLocate() {
  const [locate, setLocate] = useState<Locate>({ state: 'idle' });
  function start() {
    if (!('geolocation' in navigator)) return setLocate({ state: 'failed' });
    setLocate({ state: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const region = nearestRegion(position.coords.latitude, position.coords.longitude);
        setLocate(region ? { state: 'found', region } : { state: 'none' });
      },
      () => setLocate({ state: 'failed' }),
      { timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  }
  // 已经授权过定位的设备，进页面就自动定位（和微信一样直接显示）；没授权过的点一下再问。
  useEffect(() => {
    let active = true;
    void navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        if (active && status.state === 'granted') start();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const locateText =
    locate.state === 'found'
      ? locate.region
      : locate.state === 'locating'
        ? '正在定位…'
        : locate.state === 'none'
          ? '附近没有可选的地区，请在下方选择'
          : locate.state === 'failed'
            ? '无法获取位置，请在下方选择'
            : '点击获取当前位置';
  return { locate, start, locateText };
}

function RegionEditor({ initial }: { initial: string }) {
  const [picked, setPicked] = useState('');
  const { locate, start, locateText } = useRegionLocate();
  const { pending, error, save } = useProfileSave();
  return (
    <EditPage
      title="设置地区"
      canSave={picked !== '' && picked !== initial}
      pending={pending}
      onSave={() => void save({ city: picked })}
      fallback={FALLBACK}
    >
      <h2 className="edit-section">定位到的位置</h2>
      <div className="edit-group">
        <button
          type="button"
          className={`region-locate ${locate.state === 'found' ? '' : 'muted'}`}
          disabled={pending || locate.state === 'locating'}
          onClick={() => (locate.state === 'found' ? setPicked(locate.region) : start())}
        >
          <span className="region-pin">
            <OldIcon name="wechat/location" size={22} />
          </span>
          <span className="region-text">{locateText}</span>
          {locate.state === 'found' && picked === locate.region && (
            <OldIcon name="wechat/check" size={22} className="ink-brand" />
          )}
        </button>
      </div>
      <h2 className="edit-section">全部</h2>
      <div className="edit-group region-list">
        {initial && (
          <MenuRow
            label={initial}
            chevron={false}
            right={<span className="menu-value">已选地区</span>}
          />
        )}
        {REGION_GROUPS.map((group, index) => (
          <MenuRow key={group.label} label={group.label} to={`/profile/region/${index}`} />
        ))}
      </div>
      <ErrorLine error={error} />
    </EditPage>
  );
}

/** 第二级：某一组里的具体地区。点一下直接保存并回到个人信息（微信选到最后一级即保存）。 */
export function ProfileRegionGroupPage() {
  const { group = '' } = useParams();
  const data = REGION_GROUPS[Number(group)];
  return (
    <WithProfile title={data?.label ?? '设置地区'}>
      {(profile) => <RegionGroupList index={Number(group)} current={profile.city ?? ''} />}
    </WithProfile>
  );
}
function RegionGroupList({ index, current }: { index: number; current: string }) {
  const group = REGION_GROUPS[index];
  const { pending, error, save } = useProfileSave(2);
  return (
    <main className="edit-page">
      <NavBar title={group?.label ?? '设置地区'} fallback="/profile/region" />
      <div className="edit-group region-list first" role="radiogroup" aria-label="地区">
        {group?.items.map((item) => (
          <PickRow
            key={item}
            label={item}
            checked={item === current}
            disabled={pending}
            onClick={() => (item === current ? undefined : void save({ city: item }))}
          />
        ))}
      </div>
      <ErrorLine error={error} />
    </main>
  );
}

/**
 * 首次填写资料用的地区选择（U5，接 U2 遗留 3）：和「我 › 个人信息 › 地区」同一套页面——定位 + 省份分组，
 * 点分组再进一层选具体地区。因为首次填写页的表单还没保存，这里不直接写服务器，而是把选中的地区交回表单；
 * 两层都是页内二级页面（进浏览器历史，返回键一层一层关）。
 */
export function RegionPickerLayer({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick(city: string): void;
  onClose(): void;
}) {
  const [picked, setPicked] = useState('');
  const [group, setGroup] = useState<number | null>(null);
  const { locate, start, locateText } = useRegionLocate();
  const groupData = group === null ? undefined : REGION_GROUPS[group];
  return (
    <>
      <SubPageLayer
        title="设置地区"
        canSave={picked !== '' && picked !== value}
        onSave={() => {
          onPick(picked);
          onClose();
        }}
        onCancel={onClose}
      >
        <h2 className="edit-section">定位到的位置</h2>
        <div className="edit-group">
          <button
            type="button"
            className={`region-locate ${locate.state === 'found' ? '' : 'muted'}`}
            disabled={locate.state === 'locating'}
            onClick={() => (locate.state === 'found' ? setPicked(locate.region) : start())}
          >
            <span className="region-pin">
              <OldIcon name="wechat/location" size={22} />
            </span>
            <span className="region-text">{locateText}</span>
            {locate.state === 'found' && picked === locate.region && (
              <OldIcon name="wechat/check" size={22} className="ink-brand" />
            )}
          </button>
        </div>
        <h2 className="edit-section">全部</h2>
        <div className="edit-group region-list">
          {value && (
            <MenuRow
              label={value}
              chevron={false}
              right={<span className="menu-value">已选地区</span>}
            />
          )}
          {REGION_GROUPS.map((item, index) => (
            <MenuRow key={item.label} label={item.label} onClick={() => setGroup(index)} />
          ))}
        </div>
        {value && (
          <div className="edit-group">
            <MenuRow
              label="不填写地区"
              chevron={false}
              onClick={() => {
                onPick('');
                onClose();
              }}
            />
          </div>
        )}
      </SubPageLayer>
      {groupData && (
        <SubPageLayer
          title={groupData.label}
          canSave={false}
          onSave={() => {}}
          onCancel={() => setGroup(null)}
          className="region-group-layer"
        >
          <div className="edit-group region-list first" role="radiogroup" aria-label="地区">
            {groupData.items.map((item) => (
              <PickRow
                key={item}
                label={item}
                checked={item === value}
                onClick={() => {
                  onPick(item);
                  setGroup(null);
                  onClose();
                }}
              />
            ))}
          </div>
        </SubPageLayer>
      )}
    </>
  );
}

// ---------- 个性签名 ----------

export function ProfileAboutPage() {
  return (
    <WithProfile title="设置个性签名">
      {(profile) => <AboutEditor initial={profile.about ?? ''} />}
    </WithProfile>
  );
}
function AboutEditor({ initial }: { initial: string }) {
  const draft = useDraft(initial);
  const { pending, error, save } = useProfileSave();
  return (
    <EditPage
      title="设置个性签名"
      canSave={draft.changed}
      pending={pending}
      onSave={() => void save({ about: draft.value.trim() || null })}
      fallback={FALLBACK}
    >
      <CountTextarea
        label="个性签名"
        value={draft.value}
        maxLength={500}
        disabled={pending}
        onChange={draft.setValue}
      />
      <p className="edit-hint">所有角色都会看到这段话</p>
      <ErrorLine error={error} />
    </EditPage>
  );
}

// ---------- 微伴号 ----------

function WeibanMark() {
  return <img className="info-logo" src="/assets/old-ui/brand/weiban_logo.png" alt="" width={68} />;
}

export function AliasInfoPage() {
  const remote = useRemote(IdentityEndpoints.getAlias, { networkOnly: true });
  const navigate = useNavigate();
  const username = remote.data?.username;
  return (
    <InfoPage
      icon={<WeibanMark />}
      title={`微伴号：${username ?? '—'}`}
      description="微伴号是账号的唯一凭证，可用来登录，每 7 天可修改一次。"
      actionLabel="修改微伴号"
      actionDisabled={!remote.data}
      onAction={() => navigate('/profile/alias/edit')}
      fallback={FALLBACK}
    >
      {remote.error && (
        <p role="alert" className="error page-note">
          {remote.error}
        </p>
      )}
    </InfoPage>
  );
}

export function AliasEditPage() {
  const remote = useRemote(IdentityEndpoints.getAlias, { networkOnly: true });
  if (!remote.data)
    return (
      <main className="form-page">
        <NavBar title="修改微伴号" fallback="/profile/alias" />
        {remote.error ? (
          <p role="alert" className="notice-bar">
            {remote.error}
          </p>
        ) : (
          <SyncPendingState label="正在读取…" />
        )}
      </main>
    );
  return (
    <AliasEditor initial={remote.data.username ?? ''} nextChangeAt={remote.data.nextChangeAt} />
  );
}
function AliasEditor({ initial, nextChangeAt }: { initial: string; nextChangeAt: string | null }) {
  const auth = useAuth();
  const owner = useOwner();
  const back = useBack('/profile/alias');
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [next, setNext] = useState(nextChangeAt);
  const [now] = useState(() => Date.now());
  const changed = value.trim().toLowerCase() !== initial.toLowerCase();
  const limited = !!next && new Date(next).getTime() > now;
  const valid = Username.safeParse(value.trim()).success;
  async function save() {
    if (pending || !valid || limited || !changed) return;
    setPending(true);
    setError('');
    try {
      const who = owner();
      const result = await api.call(IdentityEndpoints.updateAlias, {
        body: { username: value.trim() },
      });
      if (!api.owns(who)) return;
      setNext(result.nextChangeAt);
      await auth.refreshUser();
      if (!api.owns(who)) return;
      window.dispatchEvent(new Event('weiban:settings-updated'));
      back();
    } catch (e) {
      if (
        e instanceof ApiFailure &&
        e.code === 'rate_limited' &&
        typeof e.details?.nextChangeAt === 'string'
      )
        setNext(e.details.nextChangeAt);
      setError(friendlyError(e));
      setPending(false);
    }
  }
  return (
    <FormPage
      title="修改微伴号"
      label="微伴号"
      value={value}
      maxLength={32}
      onChange={(v) => {
        setValue(v);
        setError('');
      }}
      canSubmit={changed && valid && !limited}
      pending={pending}
      onSubmit={() => void save()}
      fallback="/profile/alias"
      description={
        <>
          <p>4～32 位字母、数字或下划线，每 7 天可修改一次。原微伴号仍可登录。</p>
          {limited && next && <p>下次可改：{new Date(next).toLocaleString('zh-CN')}</p>}
          {changed && value.trim() !== '' && !valid && <p className="error">格式不对</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </>
      }
    />
  );
}

// ---------- 拍一拍（3.27 H1，截图 34 样式） ----------

export function ProfileNudgePage() {
  const remote = useRemote(IdentityEndpoints.getProfile);
  if (!remote.data)
    return (
      <main className="form-page">
        <NavBar title="拍一拍" fallback={FALLBACK} />
        {remote.error ? (
          <p role="alert" className="notice-bar">
            {remote.error}
          </p>
        ) : (
          <SyncPendingState label="正在读取…" />
        )}
      </main>
    );
  return <NudgeEditor initial={remote.data.nudgeSuffix ?? ''} />;
}
function NudgeEditor({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const { pending, error, save } = useProfileSave();
  const changed = value.trim() !== initial.trim();
  const preview = value.trim();
  return (
    <FormPage
      title="拍一拍"
      label="拍一拍后缀"
      prefix="拍了拍我"
      value={value}
      maxLength={15}
      placeholder="的小脑袋"
      onChange={setValue}
      canSubmit={changed}
      pending={pending}
      onSubmit={() => void save({ nudgeSuffix: preview || null })}
      fallback={FALLBACK}
      description={
        <>
          <p>角色拍了拍你时，会显示「TA 拍了拍我{preview}」。留空就不显示后缀。</p>
          <ErrorLine error={error} />
        </>
      }
    />
  );
}

/** 个人信息页的「拍一拍」行（3.27 H1）。 */
export function NudgeRow({ suffix }: { suffix: string | null | undefined }) {
  return <MenuRow label="拍一拍" value={suffix || '未设置'} to="/profile/nudge" />;
}

/** 个人信息页的「微伴号」行：进说明页（不再弹抽屉）。 */
export function AliasRow() {
  const remote = useRemote(IdentityEndpoints.getAlias, { networkOnly: true });
  return <MenuRow label="微伴号" value={remote.data?.username ?? '—'} to="/profile/alias" />;
}

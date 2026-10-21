import { describe, expect, it } from 'vitest';
import {
  captionForMemory,
  captionInstruction,
  captionLine,
  captionSnapshot,
  filterPeople,
  splitCaptionTail,
  stripCaptionTail,
  type ImageCaption,
  type ImageSlot,
} from './image-caption.js';
import { assemblePrompt, withoutImages } from './prompt-assembly.js';

const cat: ImageCaption = {
  kind: 'pet',
  description: '一只橘猫趴在窗台上晒太阳',
  textInImage: '',
  people: [],
};
const ID = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';

describe('H3 图片描述尾标：解析与剥离', () => {
  it('正文与尾标分开；按 n 对应；kind 不认识的按 other；正文里不留尾标', () => {
    const out = splitCaptionTail(
      '哇好可爱\n它叫什么呀\n<图片描述>[{"n":2,"kind":"meme","description":"熊猫头捂脸"},{"n":1,"kind":"pet","description":"橘猫晒太阳","text":"喵","people":["程澈"]},{"n":3,"kind":"xx","description":"多出来的"}]</图片描述>',
      2,
    );
    expect(out.reply).toBe('哇好可爱\n它叫什么呀');
    expect(out.captions[0]).toEqual({
      kind: 'pet',
      description: '橘猫晒太阳',
      textInImage: '喵',
      people: ['程澈'],
    });
    expect(out.captions[1]?.kind).toBe('meme');
  });

  it('容错：没闭合的尾标、代码块、单个对象、纯文字（只有一张图时）', () => {
    expect(splitCaptionTail('好看\n<图片描述>[{"n":1,"description":"海边日落"', 1)).toEqual({
      reply: '好看',
      captions: [null],
    });
    const fenced = splitCaptionTail(
      '好看\n```json\n<图片描述>{"description":"海边日落","kind":"scenery"}</图片描述>\n```',
      1,
    );
    expect(fenced.reply).toBe('好看');
    expect(fenced.captions[0]?.kind).toBe('scenery');
    const plain = splitCaptionTail('嗯嗯<图片描述>一碗热腾腾的牛肉面</图片描述>', 1);
    expect(plain.reply).toBe('嗯嗯');
    expect(plain.captions[0]?.description).toBe('一碗热腾腾的牛肉面');
    expect(stripCaptionTail('没有图也可能误写</图片描述>')).toBe('没有图也可能误写');
    expect(splitCaptionTail('普通回复', 1)).toEqual({ reply: '普通回复', captions: [null] });
  });

  it('认出的人只留名单里的', () => {
    expect(filterPeople({ ...cat, people: ['程澈', '路人甲'] }, ['程澈']).people).toEqual(['程澈']);
  });
});

describe('H3 描述的写法', () => {
  it('历史里的图用描述；表情包按表情理解；认出本人提示「图里有你自己」', () => {
    expect(captionLine(cat, { fresh: false })).toBe(
      '[对方之前发过一张图片：（宠物）一只橘猫趴在窗台上晒太阳]',
    );
    expect(
      captionLine(
        { ...cat, kind: 'magazine', people: ['程澈'] },
        {
          fresh: true,
          selfNames: ['程澈'],
        },
      ),
    ).toContain('图里有你自己');
    expect(
      captionLine({ ...cat, kind: 'meme', description: '熊猫头捂脸' }, { fresh: false }),
    ).toContain('表情包：熊猫头捂脸');
    expect(captionSnapshot(cat)).toBe('[图片：（宠物）一只橘猫趴在窗台上晒太阳]');
  });

  it('健康类图片不进记忆', () => {
    expect(captionForMemory(cat)).toBe(true);
    expect(captionForMemory({ ...cat, kind: 'health', description: '一张体检报告' })).toBe(false);
    expect(captionForMemory({ ...cat, kind: 'document', description: '经期记录 App 截图' })).toBe(
      false,
    );
  });

  it('看图要求带认人名单、尾标格式；没有附图时为空', () => {
    const slot: ImageSlot = { n: 1, mediaId: ID, ownerUserId: USER, messageId: ID, sticker: false };
    const text = captionInstruction([slot], { allowed: ['程澈'], scope: 'normal', skipped: 2 });
    expect(text).toContain('<图片描述>');
    expect(text).toContain('["程澈"]');
    expect(text).toContain('另外还有 2 张');
    expect(captionInstruction([], { allowed: null, scope: 'normal' })).toBe('');
  });
});

describe('H3 请求组装：附图只跟着本轮用户消息走', () => {
  it('图片透传到用户消息，不影响稳定开头；去图时有描述用描述、没有用看不到的说法', () => {
    const images = [{ mediaId: ID, ownerUserId: USER }];
    const assembled = assemblePrompt({
      head: [{ title: '', text: '平台规则' }],
      history: [
        { role: 'user', content: '早' },
        { role: 'assistant', content: '早呀' },
        { role: 'user', content: '[对方发来一张图片〔图1〕]', images, blindContent: '[看不到]' },
      ],
      tail: [{ title: '', text: '动态结尾' }],
    });
    const last = assembled.messages.at(-2)!;
    expect(last.images).toEqual(images);
    expect(assembled.messages.filter((m) => m.images).length).toBe(1);
    expect(assembled.stats.stablePrefixChars).toBe('平台规则'.length + '早'.length + '早呀'.length);
    const described = withoutImages(assembled.messages, () => '（宠物）橘猫');
    expect(described.at(-2)).toEqual({ role: 'user', content: '[对方发来一张图片：（宠物）橘猫]' });
    expect(withoutImages(assembled.messages).at(-2)).toEqual({ role: 'user', content: '[看不到]' });
  });
  it('缺图片能力时移除看图存档要求，保留同一动态结尾中的其他要求', () => {
    const slot: ImageSlot = { n: 1, mediaId: ID, ownerUserId: USER, messageId: ID, sticker: false };
    const note = captionInstruction([slot], { allowed: [], scope: 'normal' });
    const messages = [
      { role: 'system' as const, content: `前置要求\n${note}\n后置要求` },
      {
        role: 'user' as const,
        content: '图片',
        images: [{ mediaId: ID, ownerUserId: USER }],
        blindContent: '[看不到]',
      },
    ];
    const blind = withoutImages(messages);
    expect(blind[0]!.content).toContain('前置要求');
    expect(blind[0]!.content).toContain('后置要求');
    expect(blind[0]!.content).not.toContain('你能直接看到');
    expect(blind[0]!.content).not.toContain('<图片描述>');
    // 描述替换没有匹配到编号时也必须回退，不能假装已经把图转换成文字。
    expect(withoutImages(messages, () => '橘猫')[1]!.content).toBe('[看不到]');
  });
});

import { useState, type FormEvent } from 'react';
import {
  AdminCharacterWrite,
  CharacterAdminEndpoints,
  CharacterBasis,
  RealPersonKind,
  AgeSetting,
  AvatarPattern,
  MediaAdminEndpoints,
  type AdminCharacter,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
import { CardEditor } from '../components/card-editor.js';
const blank = (): AdminCharacterWrite => ({
  name: '',
  aliases: [],
  works: [],
  tagline: '',
  intro: '',
  tags: [],
  categoryId: null,
  birthday: null,
  fanName: null,
  fallbackGreetings: [],
  avatar: {
    imageMediaId: null,
    display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
  },
  classification: {
    basis: 'original',
    realPersonKind: null,
    ageSetting: 'adult',
    childAppearance: false,
  },
  card: { cardSchemaVersion: 1, data: {} },
});
const statuses: Record<string, string> = {
  draft: '草稿',
  pending_check: '待检测',
  published: '已上架',
  unpublished: '已下架',
  disabled: '已禁用',
};
export function CharactersPage() {
  const list = useRemote(CharacterAdminEndpoints.list);
  const [current, setCurrent] = useState<AdminCharacter | null>(null);
  const [draft, setDraft] = useState<AdminCharacterWrite>(blank);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  function edit(row: AdminCharacter) {
    setCurrent(row);
    setDraft({
      name: row.name,
      aliases: row.aliases,
      works: row.works,
      tagline: row.tagline,
      intro: row.intro,
      tags: row.tags,
      categoryId: row.categoryId,
      birthday: row.birthday,
      fanName: row.fanName,
      classification: {
        basis: row.classification.basis,
        realPersonKind: row.classification.realPersonKind,
        ageSetting: row.classification.ageSetting,
        childAppearance: row.classification.childAppearance,
      },
      avatar: { imageMediaId: row.avatar.image?.mediaId ?? null, display: row.avatar.display },
      fallbackGreetings: row.fallbackGreetings,
      card: row.card,
    });
  }
  function patch(value: Partial<AdminCharacterWrite>) {
    setDraft((d) => ({ ...d, ...value }));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      const body = AdminCharacterWrite.parse(draft);
      const row = current
        ? await api.call(CharacterAdminEndpoints.update, {
            params: { characterId: current.characterId },
            body,
          })
        : await api.call(CharacterAdminEndpoints.create, { body });
      edit(row);
      list.refresh();
      setMessage('角色草稿已保存；修改人设后需要重新完成检测。');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function status(row: AdminCharacter, publish: boolean) {
    setPending(true);
    setError('');
    try {
      const result = await api.call(
        publish ? CharacterAdminEndpoints.publish : CharacterAdminEndpoints.unpublish,
        { params: { characterId: row.characterId } },
      );
      if (current?.characterId === row.characterId) edit(result);
      list.refresh();
      setMessage(publish ? '角色已上架' : '角色已下架');
    } catch (e) {
      setError(errorText(e));
      list.refresh();
    } finally {
      setPending(false);
    }
  }
  async function avatar(file: File) {
    setPending(true);
    setError('');
    try {
      const media = await api.call(MediaAdminEndpoints.adminUpload, {
        query: { purpose: 'character_avatar' },
        file,
      });
      setDraft((d) => ({ ...d, avatar: { ...d.avatar, imageMediaId: media.mediaId } }));
      setMessage('图片已上传；保存角色后生效。');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h1>角色库</h1>
      <Feedback message={message} error={error || list.error} />
      <label>
        搜索角色
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <button
        onClick={() => {
          setCurrent(null);
          setDraft(blank());
          setError('');
          setMessage('正在新建角色');
        }}
      >
        新建角色
      </button>
      <button onClick={list.refresh}>刷新检测结果</button>
      <table>
        <thead>
          <tr>
            <th>名字</th>
            <th>状态</th>
            <th>版本</th>
            <th>必填结构</th>
            <th>人设稳定</th>
            <th>边界检测</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items
            .filter((r) => `${r.name} ${r.aliases.join(' ')} ${r.works.join(' ')}`.includes(search))
            .map((row) => (
              <tr key={row.characterId}>
                <td>{row.name}</td>
                <td>{statuses[row.status]}</td>
                <td>{row.personaVersion}</td>
                {[
                  row.publishChecks.requiredFieldsComplete,
                  row.publishChecks.personaStabilityPassed,
                  row.publishChecks.hardBoundaryCasesPassed,
                ].map((pass, i) => (
                  <td key={i}>{pass ? '通过' : '未通过'}</td>
                ))}
                <td>
                  <button onClick={() => edit(row)}>编辑 {row.name}</button>
                  <button
                    disabled={pending}
                    onClick={() => void status(row, row.status !== 'published')}
                  >
                    {row.status === 'published' ? '下架' : '上架'}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <form onSubmit={(e) => void save(e)}>
        <h2>{current ? `编辑：${current.name}` : '新建角色草稿'}</h2>
        <fieldset disabled={pending}>
          <div className="form-grid">
            <label>
              角色名字
              <input
                required
                maxLength={32}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              一句话介绍
              <input
                maxLength={60}
                value={draft.tagline}
                onChange={(e) => patch({ tagline: e.target.value })}
              />
            </label>
            <label>
              分类编号
              <input
                value={draft.categoryId ?? ''}
                onChange={(e) => patch({ categoryId: e.target.value || null })}
              />
            </label>
            <label>
              生日
              <input
                type="date"
                value={draft.birthday ?? ''}
                onChange={(e) => patch({ birthday: e.target.value || null })}
              />
            </label>
            <label>
              粉丝称呼
              <input
                maxLength={20}
                value={draft.fanName ?? ''}
                onChange={(e) => patch({ fanName: e.target.value || null })}
              />
            </label>
          </div>
          <label>
            详细介绍
            <textarea
              maxLength={1000}
              value={draft.intro}
              onChange={(e) => patch({ intro: e.target.value })}
            />
          </label>
          {(['aliases', 'works', 'tags', 'fallbackGreetings'] as const).map((key) => (
            <label key={key}>
              {
                {
                  aliases: '别名（每行一个）',
                  works: '作品（每行一个）',
                  tags: '展示标签（每行一个）',
                  fallbackGreetings: '备用开场白（每行一个，至少一条）',
                }[key]
              }
              <textarea
                value={draft[key].join('\n')}
                onChange={(e) => patch({ [key]: e.target.value.split('\n') })}
                onBlur={() => patch({ [key]: draft[key].filter((x) => x.trim()) })}
              />
            </label>
          ))}
          <fieldset>
            <legend>分类事实</legend>
            <p>
              真实人物以本人身份、真名或可识别身份事实呈现；仅借鉴灵感且使用新身份的角色归为原创。成人、恋爱与形象资格由服务器推导。
            </p>
            <div className="form-grid">
              <label>
                角色原型
                <select
                  value={draft.classification.basis}
                  onChange={(e) => {
                    const basis = CharacterBasis.parse(e.target.value);
                    patch({
                      classification: {
                        ...draft.classification,
                        basis,
                        realPersonKind: basis === 'real_person' ? 'celebrity' : null,
                      },
                    });
                  }}
                >
                  {CharacterBasis.options.map((x) => (
                    <option key={x} value={x}>
                      {{ real_person: '真人', fictional: '虚构', original: '原创' }[x]}
                    </option>
                  ))}
                </select>
              </label>
              {draft.classification.basis === 'real_person' && (
                <label>
                  真人类型
                  <select
                    value={draft.classification.realPersonKind ?? 'celebrity'}
                    onChange={(e) =>
                      patch({
                        classification: {
                          ...draft.classification,
                          realPersonKind: RealPersonKind.parse(e.target.value),
                        },
                      })
                    }
                  >
                    {RealPersonKind.options.map((x) => (
                      <option key={x} value={x}>
                        {
                          {
                            celebrity: '公众人物',
                            historical: '历史人物',
                            private_person: '身边真人',
                          }[x]
                        }
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                年龄设定
                <select
                  value={draft.classification.ageSetting}
                  onChange={(e) =>
                    patch({
                      classification: {
                        ...draft.classification,
                        ageSetting: AgeSetting.parse(e.target.value),
                      },
                    })
                  }
                >
                  <option value="adult">成年</option>
                  <option value="minor">未成年</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.classification.childAppearance}
                  onChange={(e) =>
                    patch({
                      classification: {
                        ...draft.classification,
                        childAppearance: e.target.checked,
                      },
                    })
                  }
                />
                儿童外观
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>角色头像</legend>
            <label>
              上传角色图片
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void avatar(file);
                }}
              />
            </label>
            <p>{draft.avatar.imageMediaId ? '已设置角色图片' : '使用默认非肖像头像'}</p>
            <button
              type="button"
              onClick={() => patch({ avatar: { ...draft.avatar, imageMediaId: null } })}
            >
              使用默认头像
            </button>
            <div className="form-grid">
              <label>
                头像字
                <input
                  maxLength={2}
                  value={draft.avatar.display.avatarText ?? ''}
                  onChange={(e) =>
                    patch({
                      avatar: {
                        ...draft.avatar,
                        display: { ...draft.avatar.display, avatarText: e.target.value || null },
                      },
                    })
                  }
                />
              </label>
              <label>
                头像图案
                <select
                  value={draft.avatar.display.avatarPattern}
                  onChange={(e) =>
                    patch({
                      avatar: {
                        ...draft.avatar,
                        display: {
                          ...draft.avatar.display,
                          avatarPattern: AvatarPattern.parse(e.target.value),
                        },
                      },
                    })
                  }
                >
                  {AvatarPattern.options.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                主题色
                <input
                  type="color"
                  value={draft.avatar.display.themeColor ?? '#0aa35a'}
                  onChange={(e) =>
                    patch({
                      avatar: {
                        ...draft.avatar,
                        display: { ...draft.avatar.display, themeColor: e.target.value },
                      },
                    })
                  }
                />
              </label>
            </div>
          </fieldset>
          <CardEditor card={draft.card} onChange={(card) => patch({ card })} />
          <button className="primary" type="submit">
            {pending ? '正在保存…' : '保存角色草稿'}
          </button>
        </fieldset>
      </form>
    </>
  );
}

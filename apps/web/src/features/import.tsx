import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, CaretLeft, CaretRight, Warning } from './old-icons.js';
import {
  CharacterEndpoints,
  CharacterSupplementEndpoints,
  IMPORT_LIMITS,
  ImporterEndpoints,
  ModelAccessEndpoints,
  UserCustomEndpoints,
  type ImportJob,
  type ImportResult,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { microsToPoints } from '@weiban/contracts';
import { pointsText } from './points.js';
import type { z } from 'zod';
import type { RecognizedDialogueLine } from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { NavBar } from './shell-kit.js';
import { useUpdates } from '../data/updates.js';
import { uploadImportFile } from '../data/upload.js';
import { Dialog, showToast } from './toast.js';

/*
 * 导入聊天记录生成角色（CHR-08）与导入资料生成补充设定（CHR-09）；设计 import.md。
 * 进度保存在服务器：页面按任务状态显示对应一步，离开后从「进行中的导入」回到 /imports/:jobId 继续。
 */

type Line = z.infer<typeof RecognizedDialogueLine>;
type Source = 'text' | 'file' | 'screenshots';

const failureText: Record<string, string> = {
  format_unrecognized: '没认出是谁在说话',
  insufficient_balance: '积分不足',
  model_unavailable: '模型服务暂时不可用',
  vision_unavailable: '当前模型不能识别图片，请先在 我 › 服务 › 模型 更换',
  internal: '出了点问题，请稍后重试',
};

const busyStatuses = ['collecting', 'detecting', 'analyzing'];

/** 任务状态：识别、分析中每 2 秒刷新一次，也随 data.changed(imports) 刷新。 */
function useImportJob(jobId: string | null) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'imports'
    )
      setRevision((v) => v + 1);
  });
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    void api
      .call(ImporterEndpoints.getJob, { params: { jobId }, networkOnly: true })
      .then((value) => {
        if (active) setJob(value);
      })
      .catch((e) => {
        if (active) setError(friendlyError(e));
      });
    return () => {
      active = false;
    };
  }, [jobId, revision]);
  const status = job?.status;
  useEffect(() => {
    if (!status || !busyStatuses.includes(status)) return;
    const timer = window.setTimeout(() => setRevision((v) => v + 1), 2000);
    return () => window.clearTimeout(timer);
  }, [status, job?.updatedAt, job?.progress]);
  return { job, setJob, error };
}

function FormatSample({ onClose }: { onClose(): void }) {
  return (
    <Dialog title="格式示例" actions={[{ label: '知道了', primary: true, onClick: onClose }]}>
      <pre className="format-sample">
        {`小王 2024-05-01 20:01\n明天早点来\n阿青 2024-05-01 20:02\n好呀\n\n小王：明天早点来\n阿青：好呀\n\n[20:01] 小王: 明天早点来\n[20:02] 阿青: 好呀`}
      </pre>
    </Dialog>
  );
}

// ---------- 入口：新建 / 继续 ----------

export function ImportPage() {
  const { jobId: routeJobId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get('kind') === 'supplement' ? 'supplement' : 'new_character';
  const targetCharacterId = params.get('characterId');
  const [jobId, setJobId] = useState<string | null>(routeJobId ?? null);
  const { job, setJob, error } = useImportJob(jobId);
  useEffect(() => {
    setJob(null);
    setJobId(routeJobId ?? null);
  }, [routeJobId, setJob]);
  useEffect(() => {
    if (job?.status === 'completed' && job.mergedIntoJobId)
      navigate(`/imports/${job.mergedIntoJobId}`, { replace: true });
  }, [job, navigate]);
  const title = (job?.kind ?? kind) === 'supplement' ? '导入资料' : '导入聊天记录';
  return (
    <main className="import-page">
      <header className="page-header">
        <button className="text-button" aria-label="返回" onClick={() => navigate(-1)}>
          <CaretLeft size={24} />
        </button>
        <h1>{title}</h1>
        <span />
      </header>
      {error && <p role="alert">{error}</p>}
      {!jobId ? (
        <NewImport
          kind={kind}
          targetCharacterId={targetCharacterId}
          mergeIntoJobId={params.get('mergeIntoJobId')}
          onCreated={(created) => {
            setJob(created);
            setJobId(created.jobId);
            navigate(`/imports/${created.jobId}`, { replace: true });
          }}
        />
      ) : !job ? (
        <span className="spinner" role="status" aria-label="正在读取" />
      ) : (
        <JobStep job={job} onJob={setJob} />
      )}
    </main>
  );
}

function NewImport({
  kind,
  targetCharacterId,
  mergeIntoJobId,
  onCreated,
}: {
  kind: 'new_character' | 'supplement';
  targetCharacterId: string | null;
  mergeIntoJobId: string | null;
  onCreated(job: ImportJob): void;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState('');
  const [sample, setSample] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const supplement = kind === 'supplement';
  const model = useRemote(ModelAccessEndpoints.getModelStatus, { networkOnly: true });

  async function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    let picked = [...(event.target.files ?? [])];
    event.target.value = '';
    if (source === 'screenshots') {
      const all = [...files, ...picked];
      if (all.length > IMPORT_LIMITS.maxScreenshots)
        showToast('一次最多 30 张，剩下的可以分批上传');
      setFiles(all.slice(0, IMPORT_LIMITS.maxScreenshots));
      return;
    }
    picked = picked.slice(0, 1);
    setFiles(picked);
    setPreview('');
    const file = picked[0];
    if (file) {
      const head = await file
        .slice(0, 4096)
        .text()
        .catch(() => '');
      setPreview(head.split(/\r?\n/).slice(0, 10).join('\n'));
    }
  }

  async function next() {
    if (!source) return;
    setPending(true);
    setError('');
    try {
      const job = await api.call(ImporterEndpoints.createJob, {
        body: {
          clientRequestId: crypto.randomUUID(),
          kind,
          targetCharacterId: targetCharacterId ?? null,
          mergeIntoJobId: mergeIntoJobId ?? undefined,
          sourceKind: source,
          text: source === 'text' ? text : undefined,
        },
      });
      if (source === 'text') {
        onCreated(job);
        return;
      }
      let latest = job;
      for (let i = 0; i < files.length; i++) {
        setProgress(
          source === 'screenshots' ? `正在上传第 ${i + 1} / ${files.length} 张` : '正在上传',
        );
        latest = await uploadImportFile(job.jobId, files[i]!);
      }
      latest = await api.call(ImporterEndpoints.finishUpload, { params: { jobId: job.jobId } });
      onCreated(latest);
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.status === 422 && source === 'file'
          ? '这个文件读不出来，请另存为 UTF-8 编码的 .txt'
          : friendlyError(e),
      );
    } finally {
      setPending(false);
      setProgress('');
    }
  }

  if (!source)
    return (
      <div className="stack">
        <p className="callout">
          {supplement
            ? '把你收集的采访、语录导入进来，让这里的 TA 更像 TA。'
            : '从聊天记录里读懂 TA 的说话方式，生成一个像 TA 的角色草稿。'}
        </p>
        <button className="entry-card" onClick={() => setSource('text')}>
          <strong>粘贴文字</strong>
          <CaretRight />
        </button>
        <button className="entry-card" onClick={() => setSource('file')}>
          <strong>上传文件</strong>
          <small className="hint">{supplement ? '.txt' : '.txt / .csv'}</small>
          <CaretRight />
        </button>
        {!supplement && (
          <button
            className="entry-card"
            disabled={model.data?.visionAvailable === false}
            onClick={() => setSource('screenshots')}
          >
            <strong>上传聊天截图</strong>
            <small className="hint">
              {model.data?.visionAvailable === false
                ? '当前模型不能识图，请先更换模型'
                : '最多 30 张'}
            </small>
            <CaretRight />
          </button>
        )}
        <p className="inline-tip">
          微伴不直接读取微信数据。可以先用第三方工具把聊天记录导出成文字或 csv。
        </p>
        <p className="inline-tip">聊天记录里有其他人的信息，请只导入你有权使用的内容。</p>
      </div>
    );
  return (
    <div className="stack">
      <button className="text-button" onClick={() => setSource(null)}>
        ‹ 换一种方式
      </button>
      {source === 'text' && (
        <>
          {text.length > IMPORT_LIMITS.maxChars && (
            <p className="inline-tip warn">
              超过 20 万字，只会取最近的 20 万字；也可以分批导入，分批的内容会合并进同一份草稿
            </p>
          )}
          <label>
            聊天记录
            <textarea
              rows={12}
              value={text}
              maxLength={IMPORT_LIMITS.maxChars * 2}
              onChange={(e) => setText(e.target.value)}
              placeholder={supplement ? '把资料粘贴到这里' : '把聊天记录粘贴到这里'}
            />
          </label>
          <small className="hint char-count">{text.length.toLocaleString('zh-CN')} 字</small>
          {!supplement && (
            <button className="text-button" onClick={() => setSample(true)}>
              查看格式示例
            </button>
          )}
        </>
      )}
      {source !== 'text' && (
        <>
          <button className="upload-area" onClick={() => fileInput.current?.click()}>
            {source === 'file'
              ? `点击选择文件 · 支持 ${supplement ? '.txt' : '.txt、.csv'}`
              : '点击选择截图（请按聊天顺序选择）'}
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple={source === 'screenshots'}
            accept={
              source === 'file'
                ? supplement
                  ? '.txt,text/plain'
                  : '.txt,.csv,text/plain,text/csv'
                : 'image/*'
            }
            onChange={(e) => void pickFiles(e)}
          />
          {source === 'file' && files[0] && (
            <>
              <p>{files[0].name}</p>
              {preview && <pre className="file-preview">{preview}</pre>}
            </>
          )}
          {source === 'screenshots' && files.length > 0 && (
            <div className="shot-grid">
              {files.map((file, i) => (
                <ShotThumb
                  key={`${file.name}-${i}`}
                  file={file}
                  index={i}
                  onRemove={() => setFiles((list) => list.filter((_, j) => j !== i))}
                  onMove={(dir) =>
                    setFiles((list) => {
                      const next = [...list];
                      const j = i + dir;
                      if (j < 0 || j >= next.length) return list;
                      [next[i], next[j]] = [next[j]!, next[i]!];
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={pending || (source === 'text' ? !text.trim() : files.length === 0)}
        onClick={() => void next()}
      >
        {pending ? '请稍候…' : '下一步'}
      </button>
      {sample && <FormatSample onClose={() => setSample(false)} />}
    </div>
  );
}

function ShotThumb({
  file,
  index,
  onRemove,
  onMove,
}: {
  file: File;
  index: number;
  onRemove(): void;
  onMove(dir: -1 | 1): void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <figure className="shot-thumb">
      <img src={url} alt={`第 ${index + 1} 张`} loading="lazy" />
      <figcaption>
        <button className="icon-button" aria-label="往前移" onClick={() => onMove(-1)}>
          ‹
        </button>
        {index + 1}
        <button className="icon-button" aria-label="往后移" onClick={() => onMove(1)}>
          ›
        </button>
        <button className="icon-button" aria-label="移除" onClick={onRemove}>
          ×
        </button>
      </figcaption>
    </figure>
  );
}

// ---------- 按任务状态显示对应一步 ----------

export function JobStep({ job, onJob }: { job: ImportJob; onJob(job: ImportJob): void }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [keepRaw, setKeepRaw] = useState(false);
  const [sample, setSample] = useState(false);
  const [abandon, setAbandon] = useState(false);
  async function run(work: () => Promise<ImportJob>) {
    setPending(true);
    setError('');
    try {
      onJob(await work());
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'insufficient_balance')
        setError('积分不足，暂时不能生成');
      else setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const params = { jobId: job.jobId };
  async function cancel() {
    try {
      await api.call(ImporterEndpoints.cancel, { params });
      showToast('已放弃这次导入');
      navigate('/imports', { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  switch (job.status) {
    case 'collecting':
    case 'detecting':
      return (
        <div className="empty">
          <span className="spinner" role="status" />
          <p>{job.sourceKind === 'screenshots' ? '正在识别截图…' : '正在识别发言人…'}</p>
          {job.sourceKind === 'screenshots' && (
            <span className="progress-bar" aria-hidden>
              <span style={{ transform: `scaleX(${job.progress / 100})` }} />
            </span>
          )}
        </div>
      );
    case 'awaiting_dialogue_confirmation':
      return <ConfirmDialogue job={job} onJob={onJob} />;
    case 'awaiting_speaker':
      return (
        <div className="stack">
          <h2 className="section-label">
            {job.kind === 'supplement' ? '选择资料里说话的人' : '选择要生成的角色'}
          </h2>
          <div className="panel rows">
            {job.speakers.map((speaker) => (
              <button
                key={speaker.name}
                className="row-button"
                disabled={pending}
                onClick={() =>
                  void run(() =>
                    api.call(ImporterEndpoints.selectSpeaker, {
                      params,
                      body: { speaker: speaker.name },
                    }),
                  )
                }
              >
                {speaker.name}
                <small>{speaker.messageCount.toLocaleString('zh-CN')} 条</small>
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      );
    case 'ready':
      return (
        <div className="stack">
          {job.truncated && <p className="inline-tip warn">超过 20 万字，只会取最近的 20 万字</p>}
          <div className="panel rows">
            <label className="switch-row">
              保留原文以便以后补充
              <input
                type="checkbox"
                checked={keepRaw}
                onChange={(e) => setKeepRaw(e.target.checked)}
              />
            </label>
            <p className="hint pad">默认生成后删除原文，只保留角色草稿和摘取的示例对话。</p>
            <div className="switch-row">
              保守预留上限
              <strong>
                {job.estimatedMicros === null
                  ? '—'
                  : pointsText(microsToPoints(job.estimatedMicros))}
              </strong>
            </div>
            <p className="hint pad">
              按已核准的上下文和输出上限预留，可能明显高于实际花费；最终按真实有效用量结算，多余预留退回。
            </p>
            <div className="switch-row">
              预计用时
              <span>
                {job.charCount <= IMPORT_LIMITS.fastPathChars ? '3 分钟以内' : '可能超过 3 分钟'}
              </span>
            </div>
          </div>
          {error && (
            <p role="alert">
              {error}
              {error.startsWith('积分不足') && <Link to="/wallet"> 查看积分</Link>}
            </p>
          )}
          <button
            className="primary"
            disabled={pending}
            onClick={() =>
              void run(() => api.call(ImporterEndpoints.start, { params, body: { keepRaw } }))
            }
          >
            开始生成
          </button>
        </div>
      );
    case 'analyzing':
      return (
        <div className="empty">
          <BookOpen size={64} aria-hidden />
          <p>{job.kind === 'supplement' ? '正在整理资料…' : '正在读懂 TA 的说话方式…'}</p>
          <span className="progress-bar" aria-label={`进度 ${job.progress}%`}>
            <span style={{ transform: `scaleX(${job.progress / 100})` }} />
          </span>
          <small className="hint">
            {job.progress >= 90 || Date.now() - new Date(job.updatedAt).getTime() > 3 * 60_000
              ? '快好了'
              : '大约还需要几分钟'}
          </small>
          <p className="hint">可以先离开，完成后会通知你</p>
          <button onClick={() => navigate(-1)}>先离开</button>
        </div>
      );
    case 'completed':
      return job.kind === 'supplement' ? (
        <SupplementResult job={job} />
      ) : (
        <div className="empty">
          <p>草稿生成好了</p>
          <button
            className="primary"
            onClick={() => navigate(`/characters/custom/new?import=${job.jobId}`)}
          >
            去编辑草稿
          </button>
          <ContinueImport job={job} />
        </div>
      );
    case 'failed':
      return (
        <div className="empty">
          <Warning size={64} aria-hidden />
          {job.failure === 'format_unrecognized' ? (
            <>
              <p>没认出是谁在说话</p>
              <p className="hint">每行需要带上说话人的名字</p>
              <div className="button-row">
                <button onClick={() => setSample(true)}>查看格式示例</button>
                <button
                  className="primary"
                  onClick={() => void cancel().then(() => navigate('/imports/new'))}
                >
                  返回修改
                </button>
              </div>
            </>
          ) : (
            <>
              <p>没能生成草稿：{failureText[job.failure ?? 'internal'] ?? failureText.internal}</p>
              {job.failure === 'insufficient_balance' && <Link to="/wallet">查看积分</Link>}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      api.call(ImporterEndpoints.start, { params, body: { keepRaw: job.keepRaw } }),
                    )
                  }
                >
                  重试
                </button>
                <button className="text-button" onClick={() => setAbandon(true)}>
                  放弃这次导入
                </button>
              </div>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {sample && <FormatSample onClose={() => setSample(false)} />}
          {abandon && (
            <Dialog
              title="放弃这次导入？"
              actions={[
                { label: '取消', onClick: () => setAbandon(false) },
                { label: '放弃', primary: true, onClick: () => void cancel() },
              ]}
            >
              <p className="hint">放弃后已上传的内容会被删除</p>
            </Dialog>
          )}
        </div>
      );
    default:
      return (
        <div className="empty">
          <p>这次导入已取消</p>
          <Link to="/imports">返回</Link>
        </div>
      );
  }
}

/** 截图：确认识别出的对话（import.md 2.3.1）。点一条可改成对方 / 我说的，或删掉。 */
function ConfirmDialogue({ job, onJob }: { job: ImportJob; onJob(job: ImportJob): void }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [edited, setEdited] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void api
      .call(ImporterEndpoints.getRecognizedDialogue, {
        params: { jobId: job.jobId },
        networkOnly: true,
      })
      .then((r) => {
        if (alive) setLines(r.items);
      })
      .catch((e) => {
        if (alive) setError(friendlyError(e));
      });
    return () => {
      alive = false;
    };
  }, [job.jobId]);
  const other = lines?.find((l) => l.speaker !== '我')?.speaker ?? '对方';
  function update(lineId: string, change: 'swap' | 'delete') {
    setEdited(true);
    setActive(null);
    setLines((list) =>
      (list ?? []).flatMap((l) =>
        l.lineId !== lineId
          ? [l]
          : change === 'delete'
            ? []
            : [{ ...l, speaker: l.speaker === '我' ? other : '我' }],
      ),
    );
  }
  return (
    <div className="stack">
      <p className="inline-tip">
        截图识别可能会认错说话的人，请检查一遍。点一条消息可以改成对方说的或删掉。
      </p>
      {!lines && !error && <span className="spinner" role="status" />}
      <div className="dialogue-preview">
        {lines?.map((line, i) => (
          <div key={line.lineId}>
            {(i === 0 || lines[i - 1]!.screenshotIndex !== line.screenshotIndex) && (
              <p className="system-tip">第 {line.screenshotIndex + 1} 张</p>
            )}
            <button
              className={`dialogue-line ${line.speaker === '我' ? 'mine' : ''}`}
              onClick={() => setActive(active === line.lineId ? null : line.lineId)}
            >
              <span className="message-bubble">{line.text}</span>
            </button>
            {active === line.lineId && (
              <div className="button-row">
                <button onClick={() => update(line.lineId, 'swap')}>
                  {line.speaker === '我' ? '改成对方说的' : '改成我说的'}
                </button>
                <button className="danger" onClick={() => update(line.lineId, 'delete')}>
                  删除这条
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={pending || !lines}
        onClick={() => {
          setPending(true);
          setError('');
          void api
            .call(ImporterEndpoints.confirmDialogue, {
              params: { jobId: job.jobId },
              body: edited && lines ? { lines } : {},
            })
            .then(onJob)
            .catch((e) => setError(friendlyError(e)))
            .finally(() => setPending(false));
        }}
      >
        下一步
      </button>
    </div>
  );
}

/** 补充设定导入结果确认（import.md 3.2）：每行一条，默认全选；自定义角色合并进人设。 */
function SupplementResult({ job }: { job: ImportJob }) {
  const navigate = useNavigate();
  const characterId = job.targetCharacterId ?? '';
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  const [items, setItems] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Extract<ImportResult, { kind: 'supplement' }> | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .call(ImporterEndpoints.getResult, { params: { jobId: job.jobId }, networkOnly: true })
      .then((result) => {
        if (!alive || result.kind !== 'supplement') return;
        setResult(result);
        const list = result.text
          .split(/\r?\n/)
          .map((l) => l.replace(/^[-·•\d.、\s]+/, '').trim())
          .filter(Boolean);
        setItems(list);
        setChosen(new Set(list.map((_, i) => i)));
      })
      .catch((e) => {
        if (alive) setError(friendlyError(e));
      });
    return () => {
      alive = false;
    };
  }, [job.jobId]);
  const custom = profile.data?.kind === 'custom';
  async function saveDraft() {
    if (!result || !items) return;
    setPending(true);
    try {
      await api.call(ImporterEndpoints.saveResultDraft, {
        params: { jobId: job.jobId },
        body: { ...result, text: items.filter((_, i) => chosen.has(i)).join('\n') },
      });
      showToast('草稿已保存');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!items) return;
    const picked = items.filter((_, i) => chosen.has(i));
    if (picked.length === 0) return;
    setPending(true);
    setError('');
    try {
      if (custom) {
        const mine = await api.call(UserCustomEndpoints.list);
        const current = mine.items.find((c) => c.characterId === characterId);
        const description = [current?.description ?? '', ...picked].join('\n').slice(0, 2000);
        await api.call(UserCustomEndpoints.update, {
          params: { characterId },
          body: { description },
        });
      } else {
        const existing = await api.call(CharacterSupplementEndpoints.getSupplement, {
          params: { characterId },
        });
        const text = [existing?.text ?? '', ...picked].filter(Boolean).join('\n').slice(0, 5000);
        await api.call(CharacterSupplementEndpoints.putSupplement, {
          params: { characterId },
          body: { text },
        });
      }
      showToast(`已添加 ${picked.length} 条`);
      navigate(`/characters/${characterId}/supplement`, { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <h2 className="section-label">{custom ? '合并进 TA 的人设' : '确认导入结果'}</h2>
      {!items && !error && <span className="spinner" role="status" />}
      <div className="panel rows">
        {items?.map((item, i) => (
          <label key={i} className="check-row">
            <input
              type="checkbox"
              checked={chosen.has(i)}
              onChange={(e) =>
                setChosen((set) => {
                  const next = new Set(set);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  return next;
                })
              }
            />
            <span>
              {item}
              {custom && <small className="hint"> 加入：人设描述</small>}
            </span>
          </label>
        ))}
      </div>
      <p className="hint">涉及角色分类、年龄或成人模式的内容不会生效。</p>
      {(result?.filteredCount ?? 0) > 0 && (
        <p className="inline-tip">{result?.filteredCount} 条不会生效</p>
      )}
      {result?.conflicts?.map((conflict, i) => (
        <p className="inline-tip" key={i}>
          {conflict.field}：导入内容「{conflict.supplementValue}」与公开资料「{conflict.publicValue}
          」冲突，以公开资料为准。
        </p>
      ))}
      <button disabled={pending || !result} onClick={() => void saveDraft()}>
        保存草稿
      </button>
      <ContinueImport job={job} />
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={pending || chosen.size === 0}
        onClick={() => void save()}
      >
        添加 {chosen.size} 条
      </button>
    </div>
  );
}

function ContinueImport({ job }: { job: ImportJob }) {
  const query = new URLSearchParams({ kind: job.kind, mergeIntoJobId: job.jobId });
  if (job.targetCharacterId) query.set('characterId', job.targetCharacterId);
  return <Link to={`/imports/new?${query.toString()}`}>继续导入下一批</Link>;
}

// ---------- 进行中的导入 ----------

const statusText: Record<string, string> = {
  collecting: '等待上传',
  detecting: '正在识别',
  awaiting_dialogue_confirmation: '待确认识别结果',
  awaiting_speaker: '待选择角色',
  ready: '待开始',
  analyzing: '正在生成',
  completed: '待保存',
  failed: '生成失败',
};

export function useActiveImports() {
  const jobs = useRemote(ImporterEndpoints.listJobs, { networkOnly: true });
  const { refresh } = jobs;
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'imports'
    )
      refresh();
  });
  return (jobs.data?.items ?? []).filter((j) => j.status !== 'cancelled');
}

/** 「创建自己的角色」页顶部的「进行中的导入」行。 */
export function ActiveImportsRow() {
  const active = useActiveImports().filter((j) => j.kind === 'new_character');
  if (active.length === 0) return null;
  return (
    <Link className="panel row-link" to="/imports">
      <span>
        进行中的导入 · {active.length > 1 ? `${active.length} 个` : statusText[active[0]!.status]}
      </span>
      <small>›</small>
    </Link>
  );
}

export function ImportListPage() {
  const jobs = useActiveImports();
  return (
    <main>
      <NavBar title="进行中的导入" fallback="/me" />
      <Link className="primary button" to="/imports/new">
        导入聊天记录
      </Link>
      {jobs.length === 0 && <p className="empty">没有进行中的导入</p>}
      <div className="panel rows">
        {jobs.map((job) => (
          <Link key={job.jobId} to={`/imports/${job.jobId}`}>
            <span className="overview-name">
              {job.kind === 'supplement' ? '补充设定' : (job.selectedSpeaker ?? '聊天记录')}
              <small className="hint">
                {statusText[job.status] ?? '处理中'} ·{' '}
                {new Date(job.createdAt).toLocaleDateString('zh-CN')}
              </small>
            </span>
            <CaretRight />
          </Link>
        ))}
      </div>
    </main>
  );
}

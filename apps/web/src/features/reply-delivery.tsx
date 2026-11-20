import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReplyDeliveryEndpoints, type ReplyDeliveryIssue } from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';

/** Only the mounted window of the chat is queried. A delivery update invalidates its original bubble. */
export function useReplyDelivery(conversationId: string, messageIds: string[]) {
  const [revision, refresh] = useState(0);
  const key = messageIds.join(',');
  const owner = api.ownerKey();
  const [result, setResult] = useState<{
    conversationId: string;
    owner: string | null;
    items: Map<string, ReplyDeliveryIssue>;
  }>();
  const [busy, setBusy] = useState<string | null>(null);
  useUpdates((update) => {
    if (update.type !== 'data.changed') return;
    const data = update.data as { section?: string; itemId?: string | null } | undefined;
    if (data?.section === 'reply_delivery' && data.itemId && messageIds.includes(data.itemId))
      refresh((n) => n + 1);
  });
  useEffect(() => {
    if (!key) return;
    const control = new AbortController();
    const timer = window.setTimeout(() => {
      const ids = key.split(',');
      const chunks: Promise<{ items: ReplyDeliveryIssue[] }>[] = [];
      for (let i = 0; i < ids.length; i += 80)
        chunks.push(
          api.call(ReplyDeliveryEndpoints.statuses, {
            params: { conversationId },
            body: { messageIds: ids.slice(i, i + 80) },
            signal: control.signal,
          }),
        );
      void Promise.all(chunks)
        .then((pages) => {
          if (!control.signal.aborted && api.ownerKey() === owner)
            setResult({
              conversationId,
              owner,
              items: new Map(
                pages.flatMap((p) => p.items.map((item) => [item.messageId, item] as const)),
              ),
            });
        })
        .catch(() => {
          /* Status is supplementary to the existing message. Re-entering reloads it. */
        });
    }, 90);
    return () => {
      window.clearTimeout(timer);
      control.abort();
    };
  }, [conversationId, key, owner, revision]);
  async function retry(issue: ReplyDeliveryIssue, onError: (message: string) => void) {
    if (busy) return;
    setBusy(issue.messageId);
    try {
      await api.call(ReplyDeliveryEndpoints.retry, {
        params: { conversationId, messageId: issue.messageId },
        body: { epoch: issue.epoch },
      });
    } catch (error) {
      if (api.ownerKey() === owner) onError(friendlyError(error));
    } finally {
      setBusy(null);
      refresh((n) => n + 1);
    }
  }
  return {
    items:
      key && result?.conversationId === conversationId && result.owner === owner
        ? result.items
        : undefined,
    busy,
    retry,
  };
}

const reasons: Record<ReplyDeliveryIssue['reason'], string> = {
  provider_unavailable: '角色暂时没能回复。',
  model_unavailable: '当前模型不可用，角色暂时没能回复。',
  insufficient_balance: '积分不足，这条消息还没有角色回复。',
  budget_exceeded: '今日预算已用完，这条消息还没有角色回复。',
  concurrency_limited: '模型调用繁忙，角色暂时没能回复。',
  request_too_large: '这次回复预计花费过高，已暂停。',
  unavailable: '这条消息的角色回复未完成。',
};
export function ReplyDeliveryNotice({
  issue,
  busy,
  onRetry,
}: {
  issue: ReplyDeliveryIssue;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="wx-reply-delivery" role="status">
      <span>
        {issue.state === 'retrying' || busy ? '正在重新获取角色回复…' : reasons[issue.reason]}
      </span>
      {issue.canRetry && !busy && (
        <button type="button" className="text-link" onClick={onRetry}>
          重试角色回复
        </button>
      )}
      {issue.reason === 'insufficient_balance' && <Link to="/wallet">查看积分</Link>}
    </div>
  );
}

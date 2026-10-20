/**
 * 3.23：删除模型（单个 / 批量）。先向服务器要「会清理哪些引用」的预览，确认框里写清后果和受影响数量，
 * 确认后删除。删除是软删：模型从目录、用户端列表、场景可选列表消失，线路一并删除（不再挡上游账号删除）；
 * 历史调用记录、用量、对账仍显示模型名（标「已删除」）。同一模型键可以重新添加。
 * 「角色生态决策」模型存在生态配置里，删除后由这里一并清空。
 */
import { App } from 'antd';
import {
  EcologyAdminEndpoints,
  ModelAccessAdminEndpoints,
  type AdminModel,
  type ModelDeletionImpact,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { useToast } from '../../ui/page.js';
import { INTERNAL_USE_LABELS, SCENARIO_LABELS } from './shared.js';

function impactLines(impact: ModelDeletionImpact, ecologyDecision: boolean): string[] {
  const lines: string[] = [];
  if (impact.users > 0)
    lines.push(
      `${impact.users} 个用户的场景配置（共 ${impact.scenarioSelections} 项）会被清空，这些场景回到「未配置」，用户需要重新选模型（文本聊天被清空的用户进聊天时会弹出首次引导）`,
    );
  if (impact.characters > 0)
    lines.push(
      `${impact.characters} 个角色设置（共 ${impact.characterOverrides} 项）会被清空，改为跟随场景配置`,
    );
  if (impact.recommended.length > 0)
    lines.push(
      `场景推荐：${impact.recommended.map((s) => SCENARIO_LABELS[s] ?? s).join('、')}（改为未指定）`,
    );
  const internal = impact.internal.map((u) => INTERNAL_USE_LABELS[u] ?? u);
  if (ecologyDecision) internal.push('角色生态决策');
  if (internal.length > 0) lines.push(`平台内部模型：${internal.join('、')}（改为未指定）`);
  if (impact.displayMultiplierBase)
    lines.push('展示倍率的基准模型（改为未设置，自动倍率不再显示）');
  if (impact.discounts > 0) lines.push(`${impact.discounts} 个限时折扣会被删除`);
  if (impact.pricedModels > 0)
    lines.push(`价目表：自动发布不含这 ${impact.pricedModels} 个模型价格的新版本（历史版本保留）`);
  if (impact.routes > 0) lines.push(`${impact.routes} 条上游线路一并删除（不再挡上游账号删除）`);
  return lines;
}

/** 返回 askDelete(models)：预览 → 确认框 → 删除。onDone 在删除成功后调用。 */
export function useDeleteModels(onDone: (deletedKeys: string[]) => void) {
  const { modal } = App.useApp();
  const toast = useToast();

  return async function askDelete(targets: AdminModel[]) {
    const modelKeys = targets.map((m) => m.modelKey);
    if (modelKeys.length === 0) return;
    let impact: ModelDeletionImpact;
    let ecology: Awaited<ReturnType<typeof loadEcology>> = null;
    const hide = toast.loading('正在统计受影响的设置…', 0);
    try {
      [impact, ecology] = await Promise.all([
        api.call(ModelAccessAdminEndpoints.previewDeleteModels, { body: { modelKeys } }),
        loadEcology(),
      ]);
    } catch (e) {
      toast.error(errorText(e));
      return;
    } finally {
      hide();
    }
    const ecologyDecision =
      !!ecology?.config.decisionModelKey && modelKeys.includes(ecology.config.decisionModelKey);
    const lines = impactLines(impact, ecologyDecision);
    const names = impact.models.map((m) => m.displayName);
    const title =
      names.length === 1 ? `删除模型「${names[0]}」？` : `删除选中的 ${names.length} 个模型？`;

    modal.confirm({
      title,
      centered: true,
      width: 520,
      okText: names.length === 1 ? '删除' : `删除 ${names.length} 个`,
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <div className="delete-impact">
          {names.length > 1 && (
            <p className="delete-impact-names">
              {names.slice(0, 8).join('、')}
              {names.length > 8 ? ` 等 ${names.length} 个` : ''}
            </p>
          )}
          <p>删除后从模型目录、用户端模型列表和各场景的可选列表里消失，不能恢复。</p>
          {lines.length > 0 ? (
            <>
              <p className="delete-impact-head">同时会清理：</p>
              <ul>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="delete-impact-head">没有用户、角色或平台设置在用它。</p>
          )}
          <p className="delete-impact-foot">
            历史调用记录、用量和对账仍会显示模型名（标「已删除」）。以后可以用同一个模型键重新添加。
          </p>
        </div>
      ),
      onOk: async () => {
        try {
          const done = await api.call(ModelAccessAdminEndpoints.deleteModels, {
            body: { modelKeys },
          });
          if (ecologyDecision && ecology)
            await api
              .call(EcologyAdminEndpoints.updateConfig, {
                body: { ...ecology.config, decisionModelKey: null },
              })
              .catch((e: unknown) =>
                toast.warning(`模型已删除，但角色生态决策模型没清空：${errorText(e)}`),
              );
          toast.success(
            done.models.length === 1 ? '已删除' : `已删除 ${done.models.length} 个模型`,
          );
          onDone(modelKeys);
        } catch (e) {
          toast.error(errorText(e));
          throw e;
        }
      },
    });
  };
}

async function loadEcology() {
  try {
    return await api.call(EcologyAdminEndpoints.getOverview);
  } catch {
    return null; // 生态配置读不到时不影响删除，只是确认框里不提「角色生态决策」
  }
}

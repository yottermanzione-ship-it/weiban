/**
 * plaza 的注入令牌（T-087）。
 *
 * plaza 不 import characters 的实现，只经契约端口办事（persona-plaza.md 第 2 节）：
 * - PLAZA_CHARACTERS：characters 提供的 CharacterPlazaPort（T-088 实现），由装配入口 app.module.ts 绑定。
 * - PLAZA_SUPPLEMENT_READ：CharacterSupplementPort（应用改版前判断「是否已有补充设定」）。
 * - PLAZA_PRESET_NAMES：CharacterNameReadPort（预设改版作品显示 / 搜索「基于的预设角色名」）。
 * - PLAZA_PUBLISH_CHECK：ai-runtime 提供的 PlazaPublishCheckPort（T-089 实现）。ai-runtime 不能 import plaza，
 *   所以令牌定义在这里，由装配入口绑定（同 importer / IMPORTER_ANALYZER 的做法）。
 * - PLAZA_CLASSIFICATION_POLICY：policy 的「只能更严」判定（PolicyExtensionPort.compareClassification，T-088 实现）。
 *
 * 未绑定时：发布 / 复制 / 应用 / 更正等需要该端口的操作返回 service_unavailable 或 plaza_check_unavailable，
 * 绝不跳过检查。
 */
import type {
  CharacterNameReadPort,
  CharacterPlazaPort,
  CharacterSupplementPort,
  PlazaPublishCheckPort,
  PolicyExtensionPort,
} from '@weiban/contracts';

export const PLAZA_CHARACTERS = Symbol('weiban.plaza.characters');
export const PLAZA_SUPPLEMENT_READ = Symbol('weiban.plaza.supplement-read');
export const PLAZA_PRESET_NAMES = Symbol('weiban.plaza.preset-names');
export const PLAZA_PUBLISH_CHECK = Symbol('weiban.plaza.publish-check');
export const PLAZA_CLASSIFICATION_POLICY = Symbol('weiban.plaza.classification-policy');

export type PlazaCharacters = CharacterPlazaPort;
export type PlazaSupplementRead = CharacterSupplementPort;
export type PlazaPresetNames = CharacterNameReadPort;
export type PlazaPublishCheck = PlazaPublishCheckPort;
export type PlazaClassificationPolicy = Pick<PolicyExtensionPort, 'compareClassification'>;

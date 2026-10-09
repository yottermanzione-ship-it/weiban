/**
 * growth 模块第三部分（L6，D-L6-10～D-L6-13）：共同领养宠物（PLAY-02）与宠物图鉴（ADM-04 第 5 条）。
 * 数据归 growth（表 pets、pet_interactions、pet_album、pet_species）。图鉴图片是 media 素材（purpose = pet_art）。
 * 不惩罚：宠物不会饿死、生病、离家；成长阶段与亲密值只升不降（PLAY-02 第 8 条，P-38、P-39）。
 * 按钮互动不调用模型、不花钱；「让 TA 起名」经事件交给 ai-runtime，候选名经 PetNamingPort 回传。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, NoContent, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

/** P-38、P-39。 */
export const PET_LIMITS = {
  perCharacter: 1,
  activeTotal: 3,
  /** 每只宠物每天计入亲密值的按钮互动次数。 */
  dailyIntimacyInteractions: 5,
  /** 成长阶段起始的领养天数（第 N 天）。 */
  stageStartDay: { baby: 1, junior: 30, adult: 100 },
  nameMaxChars: 8,
} as const;

export const PetStage = z.enum(['baby', 'junior', 'adult']);
export type PetStage = z.infer<typeof PetStage>;

export const PetInteractionKind = z.enum(['feed', 'play', 'pat']);

/** 图片引用（mediaId + 当前可用链接）。 */
export const PetImage = z.object({ mediaId: Id, url: z.url() });

export const PetAppearance = z.object({
  appearanceId: Id,
  name: z.string().min(1).max(12),
  /** 每个成长阶段的插画。 */
  images: z.object({ baby: PetImage, junior: PetImage, adult: PetImage }),
});

export const PetSpecies = z.object({
  speciesId: Id,
  name: z.string().min(1).max(12),
  intro: z.string().max(200),
  appearances: z.array(PetAppearance).min(1),
  /** 起名兜底用的预设名字（AI 候选不足时补齐）。 */
  presetNames: z.array(z.string().min(1).max(8)),
  /** 下架后不能新领养，已领养的不受影响。 */
  listed: z.boolean(),
});
export type PetSpecies = z.infer<typeof PetSpecies>;

export const Pet = z.object({
  petId: Id,
  characterId: Id,
  speciesId: Id,
  appearanceId: Id,
  name: z.string().min(1).max(PET_LIMITS.nameMaxChars),
  stage: tolerantEnum(PetStage),
  adoptedOn: LocalDate,
  /** 领养第 N 天（按用户时区，领养当天为 1）。 */
  daysAdopted: z.number().int().positive(),
  /** 亲密值，只升不降。 */
  intimacy: z.number().int().nonnegative(),
  /** 今天已计入亲密值的按钮互动次数（0～5）。 */
  todayCountedInteractions: z.number().int().nonnegative(),
  /** 「允许 TA 在朋友圈晒宠物」，默认开（PLAY-02 第 7 条）。 */
  allowMomentsShare: z.boolean(),
  status: z.enum(['active', 'sent_away']),
  sentAwayAt: Timestamp.nullable(),
  image: PetImage,
});
export type Pet = z.infer<typeof Pet>;

/** 成长记录节点（PLAY-02 第 5 条）。 */
export const PetTimelineEntry = z.object({
  kind: z.enum(['adopted', 'stage_changed', 'renamed', 'sent_away']),
  at: Timestamp,
  /** 例 { stage: 'junior' }、{ from: '团子', to: '汤圆' }。 */
  detail: z.record(z.string(), z.string()),
});

export const PetDetail = Pet.extend({ timeline: z.array(PetTimelineEntry) });
export type PetDetail = z.infer<typeof PetDetail>;

export const PetAlbumPhoto = z.object({
  photoId: Id,
  mediaId: Id,
  /** character = 角色发来的宠物照片（来自私聊消息）；user = 用户自己上传。 */
  source: z.enum(['character', 'user']),
  messageId: Id.nullable(),
  createdAt: Timestamp,
});

export const PetNamingRequest = z.object({
  requestId: Id,
  characterId: Id,
  status: z.enum(['pending', 'ready', 'failed']),
  /** 3 个候选名（同时作为卡片消息出现在私聊里，PLAY-02 第 3 条）。 */
  names: z.array(z.string().min(1).max(PET_LIMITS.nameMaxChars)).max(3),
});

export const PetName = z.string().trim().min(1).max(PET_LIMITS.nameMaxChars);

export const PetEndpoints = {
  listSpecies: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/pets/species`,
    auth: 'user',
    response: z.object({ items: z.array(PetSpecies) }),
    summary: '领养时可选的物种与外观（只含上架的）',
  }),
  listPets: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/pets`,
    auth: 'user',
    query: z.object({ characterId: Id.optional() }),
    response: z.object({ items: z.array(Pet) }),
    summary: '「我 → 服务 → 宠物」：所有宠物（含「回忆」中已送养的）；可按角色筛选（聊天信息页「我们的宠物」）',
  }),
  getPet: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/pets/:petId`,
    auth: 'user',
    params: z.object({ petId: Id }),
    response: PetDetail,
    summary: '宠物页：形象、名字、领养第 N 天、阶段、亲密值、成长记录',
  }),
  requestNames: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/pets/naming-requests`,
    auth: 'user',
    body: z.object({ characterId: Id, speciesId: Id, appearanceId: Id }),
    response: PetNamingRequest,
    summary:
      '「让 TA 起名」：发出 growth.pet_naming_requested，ai-runtime 生成 3 个候选名并发到私聊（一次聊天回复）；客户端轮询或等 growth.changed(section = pets)',
  }),
  getNamingRequest: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/pets/naming-requests/:requestId`,
    auth: 'user',
    params: z.object({ requestId: Id }),
    response: PetNamingRequest,
    summary: '起名请求状态与候选名',
  }),
  adopt: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/pets`,
    auth: 'user',
    body: z.object({
      clientRequestId: Id,
      characterId: Id,
      speciesId: Id,
      appearanceId: Id,
      name: PetName,
      namingRequestId: Id.nullable().optional(),
    }),
    response: PetDetail,
    summary:
      '完成领养（PLAY-02 第 3 条），成功 201；超过 P-38 返回 422 limit_reached。私聊写系统提示 pet_adopted，发出 growth.pet_adopted（角色回应一次、瞬间卡、成就第 29 号）',
  }),
  updatePet: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/pets/:petId`,
    auth: 'user',
    params: z.object({ petId: Id }),
    body: z.object({ name: PetName.optional(), allowMomentsShare: z.boolean().optional() }),
    response: PetDetail,
    summary: '改名（PLAY-02 第 13 条，不调用模型）、朋友圈开关；已送养的不能改名（409 conflict）',
  }),
  interact: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/pets/:petId/interactions`,
    auth: 'user',
    params: z.object({ petId: Id }),
    body: z.object({ kind: PetInteractionKind, clientActionId: Id }),
    response: z.object({ pet: Pet, intimacyAdded: z.number().int().nonnegative() }),
    summary: '喂食 / 玩耍 / 摸摸（不调用模型、不花钱）；每天前 5 次各 +1 亲密值（P-39）；幂等',
  }),
  sendAway: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/pets/:petId/send-away`,
    auth: 'user',
    params: z.object({ petId: Id }),
    response: PetDetail,
    summary: '送养（二次确认在客户端）：移入「回忆」，记录与相册保留；发出 growth.pet_sent_away（角色回应一次，不挽留）',
  }),
  listAlbum: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/pets/:petId/album`,
    auth: 'user',
    params: z.object({ petId: Id }),
    response: z.object({ items: z.array(PetAlbumPhoto) }),
    summary: '宠物相册（角色发来的照片 + 用户上传的）',
  }),
  addAlbumPhoto: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/pets/:petId/album`,
    auth: 'user',
    params: z.object({ petId: Id }),
    body: z.object({ mediaId: Id }),
    response: PetAlbumPhoto,
    summary: '上传照片到相册（先 POST /media?purpose=pet_photo）',
  }),
  deleteAlbumPhoto: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/pets/:petId/album/:photoId`,
    auth: 'user',
    params: z.object({ petId: Id, photoId: Id }),
    response: NoContent,
    summary: '从相册移除（不删除聊天里的原消息）',
  }),
} as const;

export const PetSpeciesWrite = PetSpecies.omit({ speciesId: true, appearances: true }).extend({
  appearances: z
    .array(
      z.object({
        appearanceId: Id.optional(),
        name: z.string().min(1).max(12),
        imageMediaIds: z.object({ baby: Id, junior: Id, adult: Id }),
      }),
    )
    .min(1),
});

export const PetSpeciesAdminEndpoints = {
  listSpecies: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/pet-species`,
    auth: 'admin',
    response: z.object({ items: z.array(PetSpecies) }),
    summary: '宠物图鉴（含下架的）',
  }),
  createSpecies: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/pet-species`,
    auth: 'admin',
    body: PetSpeciesWrite,
    response: PetSpecies,
    summary: '新增物种（图片先 POST /admin/media?purpose=pet_art）；写审计',
  }),
  updateSpecies: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/pet-species/:speciesId`,
    auth: 'admin',
    params: z.object({ speciesId: Id }),
    body: PetSpeciesWrite.partial(),
    response: PetSpecies,
    summary: '编辑、上架 / 下架物种（listed）；外观只能新增和改图，不能删除已被领养的外观',
  }),
} as const;

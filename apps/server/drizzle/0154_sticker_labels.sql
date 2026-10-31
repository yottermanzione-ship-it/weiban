-- 0154：表情包离线标签入库表（2026-11-01 晓楠批准建表，提案 sticker-tags-migration-proposal-20261031）。
-- 新表 media.library_sticker_labels，一 sticker 一行；不改 library_stickers.description，不新增其他列。
-- 编号 0154：main 最大号为 0151，0152 归小V分支（0152_official_identity），0153 归生态分支
-- （0153_ecology_follow_ups），本分支顺延取 0154；journal idx 为 154，合并顺序按号段；
-- tag 与文件名为 0154_sticker_labels。
-- retry_excluded 为排除标记：回填时与 review_needed 同值（低可信度 141 行与空白占位图为 true），
-- listStickersForCharacter 整行排除已有标签行且任一标记为 true 的表情；复核通过须同时清掉两标记，
-- 空白占位图（stickerId 385ba228-62e9-5af3-bb05-8728d139ca7c）永久不清除。
CREATE TABLE media.library_sticker_labels (
  sticker_id uuid NOT NULL REFERENCES media.library_stickers (id) ON DELETE CASCADE,
  media_id uuid NOT NULL,
  content_hash text NOT NULL,
  full_description text NOT NULL,
  image_text text NOT NULL,
  literal_meaning text NOT NULL,
  usage_meaning text NOT NULL,
  suitable_contexts text NOT NULL,
  unsuitable_contexts text NOT NULL,
  primary_tag text NOT NULL,
  emotion jsonb NOT NULL,
  confidence numeric NOT NULL,
  review_needed boolean NOT NULL DEFAULT false,
  retry_excluded boolean NOT NULL DEFAULT false,
  model text NOT NULL,
  tag_version text NOT NULL,
  tagged_at timestamptz NOT NULL,
  CONSTRAINT library_sticker_labels_pkey PRIMARY KEY (sticker_id)
);

CREATE INDEX library_sticker_labels_media_idx ON media.library_sticker_labels (media_id);

COMMENT ON TABLE media.library_sticker_labels IS
  '表情包离线打标签的完整意思（sticker-tag-v1）；回填脚本幂等写入，选图 LEFT JOIN 读出，review_needed/retry_excluded 为 true 的行默认不参与选图';
COMMENT ON COLUMN media.library_sticker_labels.retry_excluded IS
  '排除标记：低可信度行与空白占位图为 true；复核通过后与 review_needed 一起清掉，空白占位图永久保留';

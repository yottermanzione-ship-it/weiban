-- 0142_ecology_weibo_media.sql（10-25：角色微博公开素材的图片链路）
--
-- 背景：微博同步条目（ai_runtime.weibo_items）原本只有文字/来源/日期；朋友圈配图只能借图库或 AI 图，
-- 用户明确要求只使用该角色微博自己的图片。这里存「已核对过是该帖自己在公开页面上声明的图片」：
--   * 原图按图片地址摘要（image_key）跨条目共享，同一张图只下载/入库一次，不按用户重复下载；
--   * 图片对象由服务器以 owner 为空、purpose = weibo_material 写入（平台所有、公开可读），
--     不接受用户上传，也不放任何用户私人图；
--   * weibo_items.media_state 记录采集结果，被微博访客/反爬拦截（visitor/passport、432）时记为
--     unavailable，只发文字，不换替代图；冷却由 media_attempted_at 控制，不反复抓同一个被拦截页面。
-- 历史旧动态不重写：新列默认 NULL，旧行行为不变。

ALTER TABLE ai_runtime.weibo_items
  ADD COLUMN media_state text,
  ADD COLUMN media_attempted_at timestamptz;

ALTER TABLE ai_runtime.weibo_items
  ADD CONSTRAINT weibo_items_media_state CHECK (
    media_state IS NULL OR media_state IN ('fetching', 'ready', 'none', 'unavailable')
  );

CREATE TABLE ai_runtime.weibo_item_media (
  item_id     uuid        NOT NULL REFERENCES ai_runtime.weibo_items (id) ON DELETE CASCADE,
  position    integer     NOT NULL,
  image_key   text        NOT NULL,
  media_id    uuid        NOT NULL,
  source_url  text        NOT NULL,
  created_at  timestamptz NOT NULL,
  CONSTRAINT weibo_item_media_pkey PRIMARY KEY (item_id, position),
  CONSTRAINT weibo_item_media_item_key UNIQUE (item_id, image_key)
);

CREATE INDEX weibo_item_media_image_key_idx ON ai_runtime.weibo_item_media (image_key);

-- 10-21 试用反馈第三轮 G3-1（契约 3.26）：models.dev 公开模型数据的本地缓存（只有一行）。
-- 只存预填需要的字段（价格、上下文、最大输出、能否识图），每天抓一次，后台可手动刷新；失败保留上次数据。
-- 美元→人民币汇率存 model_access.settings（键 models_dev_settings），不在这里。
CREATE TABLE model_access.models_dev_snapshot (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fetched_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  model_count integer NOT NULL DEFAULT 0,
  provider_count integer NOT NULL DEFAULT 0,
  data jsonb,
  updated_at timestamptz NOT NULL
);

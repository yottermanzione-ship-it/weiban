-- S：公开查询缓存（无查询原文 / 无网页正文）、跨进程限频、空密钥 DeepSeek 搜索上游。
CREATE TABLE model_access.web_search_cache (
  query_key text PRIMARY KEY,
  purpose text NOT NULL,
  results jsonb,
  lease_token uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX web_search_expiry_idx ON model_access.web_search_cache (expires_at);
CREATE TABLE model_access.web_tool_limits (
  key text PRIMARY KEY,
  "window" text NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  updated_at timestamptz NOT NULL
);
INSERT INTO model_access.upstreams (
  id, name, kind, base_url, secret_ciphertext, display_prefix, display_suffix,
  status, status_changed_at, created_at, updated_at, provider, enabled, note
) VALUES (
  '019f7f00-0000-7000-8000-000000000131', 'DeepSeek 联网搜索', 'deepseek_search',
  'https://api.deepseek.com', decode('', 'hex'), '', '', 'invalid', now(), now(), now(), 'deepseek', true,
  '待配置密钥；配置后将 deepseek-search 登记为搜索模型并选入平台内部「联网搜索」，按后台价目计费。'
) ON CONFLICT (id) DO NOTHING;

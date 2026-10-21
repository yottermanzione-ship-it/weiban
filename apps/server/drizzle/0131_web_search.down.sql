-- 旧契约不认识 deepseek_search：已配置的账号必须先迁出，不能静默丢密钥或留下旧端无法解析的数据。
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM model_access.upstreams u WHERE kind = 'deepseek_search' AND (
      id <> '019f7f00-0000-7000-8000-000000000131' OR octet_length(secret_ciphertext) > 0
      OR name <> 'DeepSeek 联网搜索' OR base_url <> 'https://api.deepseek.com'
      OR EXISTS (SELECT 1 FROM model_access.model_catalog WHERE upstream_id = u.id)
      OR EXISTS (SELECT 1 FROM model_access.model_routes WHERE upstream_id = u.id)
    )
  ) THEN RAISE EXCEPTION 'DeepSeek 搜索上游已有配置，请先迁出账号与模型引用再回滚 0131';
  END IF;
END; $$;
DELETE FROM model_access.upstreams
WHERE id = '019f7f00-0000-7000-8000-000000000131'
  AND octet_length(secret_ciphertext) = 0 AND kind = 'deepseek_search'
  AND base_url = 'https://api.deepseek.com'
  AND name = 'DeepSeek 联网搜索'
  AND NOT EXISTS (SELECT 1 FROM model_access.model_catalog WHERE upstream_id = '019f7f00-0000-7000-8000-000000000131')
  AND NOT EXISTS (SELECT 1 FROM model_access.model_routes WHERE upstream_id = '019f7f00-0000-7000-8000-000000000131');
DROP TABLE IF EXISTS model_access.web_tool_limits;
DROP TABLE IF EXISTS model_access.web_search_cache;

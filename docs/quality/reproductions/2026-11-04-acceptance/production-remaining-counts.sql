-- 仅聚合结构化计数；不读取提醒正文、用户资料、聊天、密钥或单项账单金额。
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT kind, severity, count(*) AS open_alerts,
  count(*) FILTER (WHERE last_raised_at >= '2026-11-04T13:39:36Z') AS raised_since_release
FROM push.admin_alerts WHERE acknowledged_at IS NULL GROUP BY kind, severity ORDER BY severity, kind;
SELECT a.kind, u.status AS current_upstream_status, u.enabled, count(*) AS linked_open_alerts
FROM push.admin_alerts a LEFT JOIN model_access.upstreams u ON u.id::text = a.refs->>'upstreamId'
WHERE a.acknowledged_at IS NULL AND a.severity = 'critical' AND a.kind <> 'reconciliation_flagged'
GROUP BY a.kind,u.status,u.enabled ORDER BY a.kind;
SELECT count(*) AS open_reconciliation_alerts,
  count(*) FILTER (WHERE r.id IS NULL) AS missing_runs,
  count(*) FILTER (WHERE NOT r.ledger_consistent) AS flagged_ledger_runs,
  count(*) FILTER (WHERE r.stale_holds > 0) AS flagged_hold_runs,
  count(*) FILTER (WHERE r.usage_without_charge > 0) AS missing_charge_runs,
  count(*) FILTER (WHERE r.charge_without_usage > 0) AS missing_usage_runs,
  count(*) FILTER (WHERE r.usage_amount_mismatch > 0) AS mismatched_amount_runs,
  count(*) FILTER (WHERE COALESCE((r.details->>'unknownCostCalls')::int,0) > 0) AS unknown_cost_runs,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r.upstream_diffs) d WHERE d->>'flagged'='true')) AS flagged_upstream_bill_runs,
  count(*) FILTER (WHERE r.usage_reconciled_at >= '2026-11-04T13:39:36Z') AS usage_checked_since_release
FROM push.admin_alerts a LEFT JOIN billing.reconciliation_runs r ON r.run_date::text = a.refs->>'day'
WHERE a.acknowledged_at IS NULL AND a.kind = 'reconciliation_flagged';
ROLLBACK;

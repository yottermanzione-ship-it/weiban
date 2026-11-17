CREATE TABLE billing.reward_days (
  account_id uuid NOT NULL REFERENCES billing.accounts(id) ON DELETE CASCADE,
  reward_day date NOT NULL,
  checkin_points integer NOT NULL DEFAULT 0,
  ad_points integer NOT NULL DEFAULT 0,
  intent_id uuid UNIQUE,
  provider text,
  ready_at timestamptz,
  expires_at timestamptz,
  rewarded_at timestamptz,
  receipt_id text,
  PRIMARY KEY(account_id,reward_day),
  CONSTRAINT reward_days_points CHECK (checkin_points>=0 AND ad_points>=0),
  CONSTRAINT reward_days_completion CHECK ((rewarded_at IS NULL) = (receipt_id IS NULL))
);
CREATE UNIQUE INDEX reward_provider_receipt ON billing.reward_days(provider,receipt_id);
CREATE INDEX reward_days_by_day ON billing.reward_days(reward_day);
CREATE TABLE billing.ad_revenue_reports (
  report_day date NOT NULL,
  provider text NOT NULL,
  estimated_micros bigint,
  settled_micros bigint,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(report_day,provider),
  CONSTRAINT ad_report_amount CHECK((estimated_micros IS NOT NULL OR settled_micros IS NOT NULL) AND estimated_micros>=0 AND settled_micros>=0)
);

-- 日汇总只保留人数与赠分，用户注销时仍可与平台报表核对。
CREATE TABLE billing.reward_daily_totals (
  reward_day date PRIMARY KEY,
  checkins integer NOT NULL,
  completions integer NOT NULL,
  points integer NOT NULL,
  CONSTRAINT reward_totals_nonnegative CHECK(checkins>=0 AND completions>=0 AND points>=0)
);

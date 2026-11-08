CREATE TABLE billing.scan_devices (
  id uuid PRIMARY KEY, name text NOT NULL,
  pair_hash text, pair_expires_at timestamptz NOT NULL, public_key text,
  active boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz, listener_connected boolean NOT NULL DEFAULT false,
  queued integer NOT NULL DEFAULT 0 CHECK (queued >= 0),
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX scan_devices_single_active ON billing.scan_devices ((true)) WHERE active;
CREATE UNIQUE INDEX scan_devices_public_key ON billing.scan_devices (public_key) WHERE public_key IS NOT NULL;
CREATE TABLE billing.scan_orders (
  id uuid PRIMARY KEY, client_order_id uuid NOT NULL UNIQUE, user_id uuid,
  channel text NOT NULL CHECK (channel IN ('wechat','alipay')),
  kind text NOT NULL CHECK (kind IN ('recharge','membership')),
  title text NOT NULL, amount_fen integer NOT NULL CHECK (amount_fen > 0),
  base_fen integer NOT NULL CHECK (base_fen > 0), points integer NOT NULL CHECK (points >= 0),
  purchase jsonb NOT NULL, snapshot jsonb NOT NULL, qr text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','paid','cancelled','expired','review')),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, paid_at timestamptz,
  ledger_entry_id uuid, membership_order_id uuid
);
CREATE INDEX scan_orders_amount ON billing.scan_orders (channel, amount_fen, created_at);
CREATE INDEX scan_orders_user ON billing.scan_orders (user_id, created_at);
CREATE TABLE billing.scan_receipts (
  id uuid PRIMARY KEY, device_id uuid REFERENCES billing.scan_devices(id),
  event_id text NOT NULL, channel text NOT NULL CHECK (channel IN ('wechat','alipay')),
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  observed_at timestamptz NOT NULL, posted_at timestamptz NOT NULL, received_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('review','matched','ignored')),
  reason text NOT NULL, order_id uuid REFERENCES billing.scan_orders(id),
  UNIQUE(device_id, event_id)
);
CREATE UNIQUE INDEX scan_receipts_order ON billing.scan_receipts(order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX scan_receipts_manual_reference ON billing.scan_receipts(channel,event_id) WHERE device_id IS NULL;
CREATE INDEX scan_receipts_created ON billing.scan_receipts(received_at);
CREATE INDEX scan_receipts_amount ON billing.scan_receipts(channel, amount_fen, received_at);

-- 不自动销毁任何已使用的支付记录。生产回退须保留账目，旧服务可以忽略新增表。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM billing.scan_orders) OR EXISTS (SELECT 1 FROM billing.scan_receipts) OR EXISTS (SELECT 1 FROM billing.scan_devices)
  THEN RAISE EXCEPTION 'scan payment data exists; rollback requires an explicit retention plan'; END IF;
END $$;
DROP TABLE billing.scan_receipts;
DROP TABLE billing.scan_orders;
DROP TABLE billing.scan_devices;

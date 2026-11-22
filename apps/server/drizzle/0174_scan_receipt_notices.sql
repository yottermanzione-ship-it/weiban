ALTER TABLE billing.scan_receipts
  ADD COLUMN review_reason text,
  ADD COLUMN notice_ciphertext bytea;

UPDATE billing.scan_receipts SET review_reason = reason
  WHERE device_id IS NOT NULL AND status = 'review';

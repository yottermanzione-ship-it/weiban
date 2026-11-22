DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM billing.scan_receipts WHERE notice_ciphertext IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing to discard stored payment notices';
  END IF;
END $$;

ALTER TABLE billing.scan_receipts DROP COLUMN notice_ciphertext, DROP COLUMN review_reason;

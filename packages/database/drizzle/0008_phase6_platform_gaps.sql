-- Phase 6 — platform gaps.
-- Idempotent DDL: safe to re-run.

-- EOD snapshot idempotency: at most one 'eod' snapshot per org per day.
-- Partial unique index so non-eod snapshot types are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_report_snapshots_eod_unique"
  ON "report_snapshots" ("organization_id", "snapshot_date")
  WHERE "snapshot_type" = 'eod';

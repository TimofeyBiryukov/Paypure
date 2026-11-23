-- Rules Prisma's schema can't express (Tech §5.2, 06 §2.2, 07, 08 §3.3).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Time entries (06 §2.2) ────────────────────────────────────────────────────────────────

-- One live timer per member (running or paused)
CREATE UNIQUE INDEX one_live_timer ON time_entries (member_id)
  WHERE state <> 'stopped' AND deleted_at IS NULL;

-- A stopped entry has a task. Only stopped entries can be billed or taken off unbilled
ALTER TABLE time_entries ADD CONSTRAINT time_entries_stopped_has_task
  CHECK (state <> 'stopped' OR task_id IS NOT NULL);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_live_not_billed
  CHECK (state = 'stopped' OR (invoice_id IS NULL AND off_invoice IS NULL));
-- Billed (claimed) and taken off unbilled are mutually exclusive (D10)
ALTER TABLE time_entries ADD CONSTRAINT time_entries_claim_xor_off
  CHECK (invoice_id IS NULL OR off_invoice IS NULL);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_duration_nonneg
  CHECK (duration_seconds >= 0);

-- Unbilled entries (07 §10)
CREATE INDEX time_entries_unbilled ON time_entries (workspace_id, task_id)
  WHERE invoice_id IS NULL AND off_invoice IS NULL AND state = 'stopped' AND deleted_at IS NULL;
CREATE INDEX time_entries_invoice ON time_entries (invoice_id) WHERE invoice_id IS NOT NULL;

-- At most one open segment per entry
CREATE UNIQUE INDEX one_open_segment ON time_entry_segments (time_entry_id)
  WHERE ended_at IS NULL;

-- Segments are positive and never overlap within an entry
ALTER TABLE time_entry_segments ADD CONSTRAINT segment_positive
  CHECK (ended_at IS NULL OR ended_at > started_at);
ALTER TABLE time_entry_segments ADD CONSTRAINT segment_no_overlap EXCLUDE USING gist (
  time_entry_id WITH =,
  tstzrange(started_at, coalesce(ended_at, 'infinity')) WITH &&
);

-- ── Tasks and fixed fees (07 §4.1) ────────────────────────────────────────────────────────

ALTER TABLE tasks ADD CONSTRAINT tasks_rate_only_hourly
  CHECK (rate_minor IS NULL OR billing_mode = 'hourly');
ALTER TABLE tasks ADD CONSTRAINT tasks_fixed_amount
  CHECK ((billing_mode = 'fixed' AND fixed_amount_minor > 0)
      OR (billing_mode <> 'fixed' AND fixed_amount_minor IS NULL));

-- ── Payment accounts (07 §8.1) ────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX payment_accounts_one_default ON payment_accounts (workspace_id, currency)
  WHERE is_default AND archived_at IS NULL;
ALTER TABLE payment_accounts ADD CONSTRAINT payment_accounts_has_number
  CHECK (account_number IS NOT NULL OR iban IS NOT NULL);

-- ── Invoices (08 §3) ──────────────────────────────────────────────────────────────────────

ALTER TABLE invoices ADD CONSTRAINT invoices_number_iff_not_draft
  CHECK ((number IS NULL) = (status = 'draft'));
CREATE INDEX invoices_status_due ON invoices (workspace_id, status);

-- At most one open (unfrozen) version per invoice
CREATE UNIQUE INDEX invoice_versions_one_open ON invoice_versions (invoice_id)
  WHERE frozen_at IS NULL;

-- Line maths a client can check (07 §6): Postgres round(numeric) is half away from zero
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_amount
  CHECK (amount_minor = round(qty_hundredths::numeric * rate_minor / 100));
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_task
  CHECK ((kind IN ('time', 'fixed')) = (task_id IS NOT NULL));

ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

-- ── Immutability triggers (08 §3.3) ───────────────────────────────────────────────────────

CREATE FUNCTION paypure_versions_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice version % is frozen', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER invoice_versions_frozen BEFORE UPDATE OR DELETE ON invoice_versions
  FOR EACH ROW EXECUTE FUNCTION paypure_versions_frozen();

CREATE FUNCTION paypure_version_is_frozen(v uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM invoice_versions WHERE id = v AND frozen_at IS NOT NULL)
$$;

CREATE FUNCTION paypure_children_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  vid uuid;
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME IN ('invoice_line_taxes', 'invoice_line_entries') THEN
    SELECT version_id INTO vid FROM invoice_lines WHERE id = rec.line_id;
  ELSE
    vid := rec.version_id;
  END IF;
  IF vid IS NOT NULL AND paypure_version_is_frozen(vid) THEN
    RAISE EXCEPTION '% belongs to a frozen invoice version', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME NOT IN ('invoice_line_taxes', 'invoice_line_entries')
     AND OLD.version_id IS DISTINCT FROM NEW.version_id
     AND paypure_version_is_frozen(OLD.version_id) THEN
    RAISE EXCEPTION '% belongs to a frozen invoice version', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN rec;
END $$;

CREATE TRIGGER invoice_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION paypure_children_frozen();
CREATE TRIGGER invoice_version_taxes_frozen BEFORE INSERT OR UPDATE OR DELETE ON invoice_version_taxes
  FOR EACH ROW EXECUTE FUNCTION paypure_children_frozen();
CREATE TRIGGER invoice_line_taxes_frozen BEFORE INSERT OR UPDATE OR DELETE ON invoice_line_taxes
  FOR EACH ROW EXECUTE FUNCTION paypure_children_frozen();
CREATE TRIGGER invoice_line_entries_frozen BEFORE INSERT OR UPDATE OR DELETE ON invoice_line_entries
  FOR EACH ROW EXECUTE FUNCTION paypure_children_frozen();
CREATE TRIGGER invoice_entry_changes_frozen BEFORE INSERT OR UPDATE OR DELETE ON invoice_entry_changes
  FOR EACH ROW EXECUTE FUNCTION paypure_children_frozen();

CREATE FUNCTION paypure_invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'only draft invoices can be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.number IS NOT NULL AND (
       NEW.number IS DISTINCT FROM OLD.number OR NEW.number_seq IS DISTINCT FROM OLD.number_seq
    OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
    RAISE EXCEPTION 'number, client and currency are fixed once an invoice has a number'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'issued')
    OR (OLD.status = 'issued' AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'invoice status can''t go % → %', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION paypure_invoices_guard();

CREATE FUNCTION paypure_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is write-once', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER invoice_files_write_once BEFORE UPDATE OR DELETE ON invoice_files
  FOR EACH ROW EXECUTE FUNCTION paypure_write_once();
CREATE TRIGGER invoice_activity_append_only BEFORE UPDATE OR DELETE ON invoice_activity
  FOR EACH ROW EXECUTE FUNCTION paypure_write_once();

-- Billed time on an issued invoice only changes through an approved correction (08 §5.2)
CREATE FUNCTION paypure_entry_on_issued(inv uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM invoices WHERE id = inv AND status = 'issued')
$$;

CREATE FUNCTION paypure_time_entries_billed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invoice_id IS NULL OR NOT paypure_entry_on_issued(OLD.invoice_id) THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('paypure.applying_version', true), '') <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.date IS DISTINCT FROM OLD.date
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
     OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.billable IS DISTINCT FROM OLD.billable
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'time entry % is billed on a sent invoice; propose a correction', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER time_entries_billed_guard BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION paypure_time_entries_billed_guard();

CREATE FUNCTION paypure_segments_billed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  inv uuid;
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT invoice_id INTO inv FROM time_entries WHERE id = rec.time_entry_id;
  IF inv IS NOT NULL AND paypure_entry_on_issued(inv)
     AND coalesce(current_setting('paypure.applying_version', true), '') = '' THEN
    RAISE EXCEPTION 'segments of a billed entry change only through a correction' USING ERRCODE = 'P0001';
  END IF;
  RETURN rec;
END $$;
CREATE TRIGGER time_entry_segments_billed_guard BEFORE INSERT OR UPDATE OR DELETE ON time_entry_segments
  FOR EACH ROW EXECUTE FUNCTION paypure_segments_billed_guard();

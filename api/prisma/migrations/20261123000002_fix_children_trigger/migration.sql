-- PL/pgSQL doesn't short-circuit AND, so field access must sit in its own branch.
CREATE OR REPLACE FUNCTION paypure_children_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  vid uuid;
  old_vid uuid;
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME IN ('invoice_line_taxes', 'invoice_line_entries') THEN
    SELECT version_id INTO vid FROM invoice_lines WHERE id = rec.line_id;
    IF TG_OP = 'UPDATE' THEN
      SELECT version_id INTO old_vid FROM invoice_lines WHERE id = OLD.line_id;
    END IF;
  ELSE
    vid := rec.version_id;
    IF TG_OP = 'UPDATE' THEN
      old_vid := OLD.version_id;
    END IF;
  END IF;
  IF vid IS NOT NULL AND paypure_version_is_frozen(vid) THEN
    RAISE EXCEPTION '% belongs to a frozen invoice version', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF old_vid IS NOT NULL AND old_vid IS DISTINCT FROM vid AND paypure_version_is_frozen(old_vid) THEN
    RAISE EXCEPTION '% belongs to a frozen invoice version', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN rec;
END $$;

-- Migration 028 — let each strength / improvement carry a citation back to
-- the submission, so the teacher can click "where does this come from?" and
-- jump to the passage. Same model as criteria_scores.quote/page.
--
-- Shape:  JSONB array of { "text": string, "quote": string | null, "page": int | null }
-- Existing TEXT[] rows are migrated by wrapping each string as { text: s }.
--
-- Note: Postgres rejects subqueries inside ALTER COLUMN ... USING, so the
-- conversion goes through a temporary plpgsql helper that's dropped at the end.

CREATE OR REPLACE FUNCTION _mig028_text_array_to_bullets(arr TEXT[])
RETURNS JSONB AS $$
DECLARE
  result JSONB := '[]'::jsonb;
  t      TEXT;
BEGIN
  IF arr IS NULL THEN RETURN NULL; END IF;
  FOREACH t IN ARRAY arr LOOP
    result := result || jsonb_build_array(jsonb_build_object('text', t));
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE assignments
  ALTER COLUMN ai_strengths          TYPE JSONB USING _mig028_text_array_to_bullets(ai_strengths),
  ALTER COLUMN ai_improvements       TYPE JSONB USING _mig028_text_array_to_bullets(ai_improvements),
  ALTER COLUMN approved_strengths    TYPE JSONB USING _mig028_text_array_to_bullets(approved_strengths),
  ALTER COLUMN approved_improvements TYPE JSONB USING _mig028_text_array_to_bullets(approved_improvements);

DROP FUNCTION _mig028_text_array_to_bullets(TEXT[]);

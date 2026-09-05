-- Migration 125 — фирменный стиль учебного заведения на слайдах
-- (TODO.md "### AO" Phase 4).
--
-- `presentationExport.ts` hardcodes one palette (`const C`) and no logo, so
-- every deck the platform produces looks like ИСПУМ rather than like the
-- university that paid for it. Университеты care about this more than the
-- feature list suggests: a титульный лист with the wrong (or no) logo is the
-- part a заведующий кафедрой notices first, and the part that makes a deck
-- unusable at a defence or an open lecture.
--
-- Three columns, deliberately not a theme system: an accent colour and a logo
-- are what actually appear on a slide. A full palette (backgrounds, secondary
-- text, per-slide-type rules) would be a design surface nobody has asked for
-- and every institution would then have to fill in correctly.
--
-- The logo lives in object storage like every other binary here
-- (document_figures.storage_path, migration 117) rather than as a data URI in
-- the row: it is fetched once per export, not per query, and rows stay small.
--
-- Expand/contract (CLAUDE.md invariant 12): three additive nullable columns.

ALTER TABLE institutions
  -- '#RRGGBB'. Null → the platform's own amber, i.e. exactly today's output.
  ADD COLUMN IF NOT EXISTS brand_accent_color TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_path    TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_mime    TEXT;

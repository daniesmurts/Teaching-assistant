-- Migration 090 — РОП Студия: multi-region market evidence (TODO.md Feature Z).
--
-- v0 shipped with one region per generation; the pilot region list grew
-- from 1 to 90 trudvsem-verified regions in the same session, and a single
-- programme's catchment area often spans more than one (e.g. a border
-- region + its neighbors). Converts region_code/region_name to arrays so
-- one generated section can be grounded in vacancy data across several
-- regions at once, not just the first one picked.
--
-- Preserves the one real row already generated (converts its single value
-- into a 1-element array) rather than dropping/recreating the table.

ALTER TABLE program_market_evidence ADD COLUMN region_codes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE program_market_evidence ADD COLUMN region_names TEXT[] NOT NULL DEFAULT '{}';

UPDATE program_market_evidence
   SET region_codes = ARRAY[region_code],
       region_names = ARRAY[region_name]
 WHERE region_code IS NOT NULL;

ALTER TABLE program_market_evidence DROP COLUMN region_code;
ALTER TABLE program_market_evidence DROP COLUMN region_name;

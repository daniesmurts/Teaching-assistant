-- Migration 091 — fixes a gap in migration 090: it converted
-- region_code/region_name to region_codes/region_names arrays, but left
-- vacancy_snapshot's JSONB contents in the old flat shape
-- (ProfessionSnapshot[]) instead of the new nested-by-region shape
-- (RegionSnapshot[]) the frontend/services/labourMarket.ts now expects —
-- crashed RopStudio.tsx on the one real pre-existing row
-- ("region.by_profession.map is not a function").
--
-- Wraps any still-flat snapshot into a single-region RegionSnapshot using
-- the row's own (already-migrated) region_codes[0]/region_names[0]. Guarded
-- to be a no-op on rows already in the new shape, so this is safe to run
-- even if some rows were generated between 090 and this migration.

UPDATE program_market_evidence
   SET vacancy_snapshot = jsonb_build_array(
         jsonb_build_object(
           'region_code',   region_codes[1],
           'region_name',   region_names[1],
           'by_profession', vacancy_snapshot
         )
       )
 WHERE jsonb_typeof(vacancy_snapshot) = 'array'
   AND jsonb_array_length(vacancy_snapshot) > 0
   AND NOT (vacancy_snapshot -> 0 ? 'by_profession');

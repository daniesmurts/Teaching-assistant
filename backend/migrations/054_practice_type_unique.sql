-- 054 — enforce "one practice document per type per programme".
--
-- FEATURES.md has claimed this invariant since migration 050, but nothing
-- enforced it: the import batch never checked for duplicate types and the
-- attach endpoint happily inserted a second file of the same type. The routes
-- now replace-on-reupload (deletePracticeForType) and reject duplicate types
-- within an import batch; this index is the backstop for any path that slips
-- through. Dedupe first — keep the newest upload per (programme, type), drop
-- older rows (their storage objects become orphans; a few kB, acceptable).

DELETE FROM program_documents pd
 USING program_documents newer
 WHERE pd.kind = 'practice'
   AND newer.kind = 'practice'
   AND newer.program_id = pd.program_id
   AND newer.practice_type = pd.practice_type
   AND (newer.uploaded_at > pd.uploaded_at
        OR (newer.uploaded_at = pd.uploaded_at AND newer.id > pd.id));

CREATE UNIQUE INDEX IF NOT EXISTS program_documents_practice_type_unique
    ON program_documents (program_id, practice_type)
 WHERE kind = 'practice';

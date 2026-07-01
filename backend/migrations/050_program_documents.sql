-- Migration 050 — Programme document attachments.
--
-- Extends the programme intake beyond the two documents used for analysis
-- (описание ОП, учебный план) to the fuller set КНИТУ carries per направление:
-- рабочая программа + up to four типов практик. These are stored as first-
-- class attachments — original files preserved in Yandex Object Storage,
-- metadata + storage path in this table. Description/plan continue to be
-- text-extracted into `programs.description_text` / `plan_text` for now; a
-- future refactor could migrate them into this table for a unified experience.
--
-- kind:
--   'working_programme'  — рабочая программа дисциплин (usually a single PDF)
--   'practice'           — one file per тип практики (see practice_type)
--
-- practice_type (non-null when kind='practice'; NULL otherwise):
--   'production_technological'   — Производственная (технологическая /
--                                  проектно-технологическая) практика
--   'production_pre_diploma'     — Производственная (преддипломная) практика
--   'educational_familiarization'— Учебная (ознакомительная) практика
--   'educational_operational'    — Учебная (эксплуатационная) практика

CREATE TABLE IF NOT EXISTS program_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  practice_type TEXT,
  file_name     TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  mime_type     TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  uploaded_by   UUID REFERENCES teachers(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_documents_program_idx ON program_documents (program_id, kind);

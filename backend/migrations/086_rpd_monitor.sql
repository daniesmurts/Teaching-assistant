-- Migration 086 — РПД Monitor (УМЦ progress tracking, FEATURES.md institution admin).
--
-- The head of УМЦ downloads the «Заполнение РПД и ФОС» table from АСУ
-- Университет and needs per-institute rollups, week-over-week dynamics and
-- downloadable reports. Each upload becomes an immutable SNAPSHOT so dynamics
-- («прирост с прошлой недели») fall out of comparing snapshots — she can also
-- backfill history by uploading old files.
--
-- АСУ's export has no institute column: the кафедра→институт mapping is
-- institution-owned data (rpd_dept_groups / rpd_dept_group_members), assigned
-- once in the UI and reused for every subsequent upload.
--
-- Rows store COUNTS only. АСУ's own percentage columns contain anomalies
-- (negative долг, >100%), so percentages are always recomputed server-side
-- and anomalies are surfaced, never silently fixed.

CREATE TABLE IF NOT EXISTS rpd_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  uploaded_by      UUID REFERENCES teachers(id) ON DELETE SET NULL,
  captured_at      TIMESTAMPTZ NOT NULL,   -- from the export's own header timestamp; editable
  period_label     TEXT,                   -- e.g. «с 01.09.2026 по 01.07.2027»
  source_filename  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rpd_snapshots_inst_idx ON rpd_snapshots (institution_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS rpd_snapshot_rows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID NOT NULL REFERENCES rpd_snapshots(id) ON DELETE CASCADE,
  dept_code     TEXT NOT NULL,   -- кафедра short name as printed by АСУ («НХ», «ОХТ»)
  edu_form      TEXT NOT NULL,   -- очная | очно-заочная | заочная
  edu_level     TEXT NOT NULL,   -- бакалавриат | магистратура | специалитет
  plan_count    INT  NOT NULL,
  rpd_done      INT  NOT NULL,
  rpd_review    INT  NOT NULL,
  rpd_debt      INT  NOT NULL,
  fos_done      INT  NOT NULL DEFAULT 0,
  fos_review    INT  NOT NULL DEFAULT 0,
  fos_debt      INT  NOT NULL DEFAULT 0,
  UNIQUE (snapshot_id, dept_code, edu_form, edu_level)
);

CREATE INDEX IF NOT EXISTS rpd_snapshot_rows_snapshot_idx ON rpd_snapshot_rows (snapshot_id);

-- Institute-level grouping of кафедры («ИНХН», «ИХТИ», …).
CREATE TABLE IF NOT EXISTS rpd_dept_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  sort_order       INT  NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (institution_id, name)
);

-- A кафедра code belongs to at most one group per institution.
CREATE TABLE IF NOT EXISTS rpd_dept_group_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID NOT NULL REFERENCES rpd_dept_groups(id) ON DELETE CASCADE,
  institution_id   UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  dept_code        TEXT NOT NULL,
  UNIQUE (institution_id, dept_code)
);

CREATE INDEX IF NOT EXISTS rpd_dept_group_members_group_idx ON rpd_dept_group_members (group_id);

-- Migration 043 — Program intake metadata + document import.
--
-- Extends programs with the official образовательная-программа header fields a
-- department head enters, and stores the extracted text of the two uploaded
-- PDFs (описание ОП → competencies/goals; учебный план → disciplines) so a plan
-- can be re-parsed without re-uploading. program_disciplines gains control_form
-- (экзамен/зачёт/…) captured from the учебный план.

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS specialty_name   TEXT,   -- Наименование профессии/специальности/направления/группы научных специальностей
  ADD COLUMN IF NOT EXISTS education_level  TEXT,   -- Уровень образования (free text)
  ADD COLUMN IF NOT EXISTS profile          TEXT,   -- Образовательная программа/направленность/профиль, шифр и наименование научной специальности
  ADD COLUMN IF NOT EXISTS forms_of_study   TEXT,   -- Реализуемые формы обучения
  ADD COLUMN IF NOT EXISTS description_text TEXT,   -- extracted text of the описание ОП PDF
  ADD COLUMN IF NOT EXISTS plan_text        TEXT;   -- extracted text of the учебный план PDF

ALTER TABLE program_disciplines
  ADD COLUMN IF NOT EXISTS control_form TEXT;       -- форма контроля: экзамен / зачёт / диф. зачёт / курсовая

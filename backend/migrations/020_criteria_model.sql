-- Migration 020 — criteria model.
--
-- Teachers asked us to move from "named rubric bundles" to individual reusable
-- criteria. They mix-and-match a few at grading time and set weights inline.
-- The rubric table goes away entirely (pre-launch — no real users to migrate);
-- weights now live only on the grading event in assignments.criteria_snapshot.

-- ─── 1. New criteria table ────────────────────────────────────────────────────
-- teacher_id NULL means a platform-wide global template (admin-curated).

CREATE TABLE IF NOT EXISTS criteria (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id          UUID REFERENCES teachers(id) ON DELETE CASCADE,
  course_id           UUID REFERENCES courses(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  subject             TEXT,            -- 'business' | 'economics' | 'law' | 'medicine' | 'engineering' | 'humanities' | 'general'
  is_global_template  BOOLEAN NOT NULL DEFAULT FALSE,
  is_institution_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS criteria_teacher_idx ON criteria (teacher_id);
CREATE INDEX IF NOT EXISTS criteria_global_idx
  ON criteria (subject) WHERE is_global_template;
CREATE INDEX IF NOT EXISTS criteria_institution_idx
  ON criteria (teacher_id) WHERE is_institution_shared;

-- ─── 2. criteria_snapshot column on assignments ───────────────────────────────
-- Shape: [{ criterion_id?, name, weight, max_score, score?, feedback? }]
-- criterion_id may be null for the holistic mode (no criteria selected) or for
-- assignments graded before this migration.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS criteria_snapshot JSONB;

ALTER TABLE long_reviews
  ADD COLUMN IF NOT EXISTS criteria_snapshot JSONB;

-- ─── 3. Drop old rubric_id FKs and the rubrics table ──────────────────────────
-- Pre-launch cutover — no backfill required.

ALTER TABLE assignments  DROP COLUMN IF EXISTS rubric_id;
ALTER TABLE long_reviews DROP COLUMN IF EXISTS rubric_id;
DROP TABLE IF EXISTS rubrics;

-- ─── 4. Plan limits — rename maxRubrics to maxCriteria (config-side change too)
-- Nothing schema-level needs to change: plan limits live in code (planLimits.ts).

-- ─── 5. Seed global criteria templates ────────────────────────────────────────
-- Idempotent: only inserts each by (lowered name + subject) if not already there.
-- Requires a platform_admin teacher to exist; otherwise skip silently (seed will
-- run again on a future migration once an admin is bootstrapped).

DO $$
DECLARE
  admin_id UUID;
BEGIN
  SELECT id INTO admin_id
    FROM teachers
    WHERE role = 'platform_admin'
    ORDER BY created_at
    LIMIT 1;

  IF admin_id IS NULL THEN
    RAISE NOTICE 'No platform_admin yet — skipping global criteria seed';
    RETURN;
  END IF;

  -- name, description, subject
  INSERT INTO criteria (teacher_id, name, description, subject, is_global_template)
  SELECT NULL, v.name, v.description, v.subject, TRUE
    FROM (VALUES
      -- Universal
      ('Аргументация',        'Качество аргументов, доказательная база, обоснованность выводов',                    'general'),
      ('Структура',           'Логика изложения, переходы между частями, целостность работы',                       'general'),
      ('Академический стиль', 'Соответствие академическим нормам письма, корректность терминологии',                'general'),
      ('Глубина анализа',     'Уровень критического осмысления темы, выход за рамки описания',                      'general'),
      ('Использование источников', 'Корректность ссылок, анализ литературы, релевантность источников',              'humanities'),

      -- STEM (calculation)
      ('Правильность ответа',  'Окончательный числовой/буквенный ответ верен с учётом точности',                    'engineering'),
      ('Метод решения',        'Выбран верный закон/подход, логика решения корректна',                              'engineering'),
      ('Единицы и точность',   'Правильные единицы измерения, согласованность размерностей, значащие цифры',        'engineering'),
      ('Формулы и обоснование','Корректные формулы, пояснения к ключевым шагам, нет пропущенных переходов',         'engineering'),
      ('Анализ результата',    'Проверка правдоподобности, выводы по результату, физический/инженерный смысл',      'engineering'),

      -- Business / Economics
      ('Анализ ситуации',     'Глубина и обоснованность анализа исходных данных, рынка, контекста',                  'business'),
      ('Рекомендации',        'Конкретность, применимость и обоснованность предложенных решений',                    'business'),
      ('Экономическое обоснование', 'Финансовые расчёты, оценка эффективности, учёт ограничений',                    'economics'),

      -- Law
      ('Правовое обоснование', 'Корректные ссылки на нормы права, правильное применение норм к фактам',              'law'),
      ('Юридический анализ',   'Квалификация отношений, выявление коллизий, доказательность выводов',                'law')
    ) AS v(name, description, subject)
    WHERE NOT EXISTS (
      SELECT 1 FROM criteria c
       WHERE c.is_global_template
         AND LOWER(c.name) = LOWER(v.name)
    );
END $$;

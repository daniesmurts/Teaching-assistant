-- Migration 030 — seed global rubric templates.
--
-- A starter set of rubric bundles every teacher sees in the "Рубрики" library.
-- Each references global criterion templates seeded by migration 020 (by name,
-- since ids are random). If a referenced criterion template is missing — e.g.
-- migration 020 ran before a platform_admin existed and was skipped, or an
-- admin renamed something — that template is skipped silently instead of
-- failing the migration. Idempotent: keyed on (LOWER(name) + is_global_template).

DO $$
DECLARE
  -- General / humanities
  c_argumentation UUID;
  c_structure     UUID;
  c_style         UUID;
  c_depth         UUID;
  c_sources       UUID;
  -- STEM
  c_answer        UUID;
  c_method        UUID;
  c_units         UUID;
  c_formulas      UUID;
  c_result        UUID;
  -- Business / economics
  c_situation     UUID;
  c_recommendations UUID;
  c_economic      UUID;
  -- Law
  c_legal_just    UUID;
  c_legal_anal    UUID;

  items JSONB;
BEGIN
  -- ── Look up criterion template ids by name (global only) ────────────────────
  SELECT id INTO c_argumentation   FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Аргументация')                LIMIT 1;
  SELECT id INTO c_structure       FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Структура')                   LIMIT 1;
  SELECT id INTO c_style           FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Академический стиль')         LIMIT 1;
  SELECT id INTO c_depth           FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Глубина анализа')             LIMIT 1;
  SELECT id INTO c_sources         FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Использование источников')    LIMIT 1;

  SELECT id INTO c_answer          FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Правильность ответа')         LIMIT 1;
  SELECT id INTO c_method          FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Метод решения')               LIMIT 1;
  SELECT id INTO c_units           FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Единицы и точность')          LIMIT 1;
  SELECT id INTO c_formulas        FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Формулы и обоснование')       LIMIT 1;
  SELECT id INTO c_result          FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Анализ результата')           LIMIT 1;

  SELECT id INTO c_situation       FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Анализ ситуации')             LIMIT 1;
  SELECT id INTO c_recommendations FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Рекомендации')                LIMIT 1;
  SELECT id INTO c_economic        FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Экономическое обоснование')   LIMIT 1;

  SELECT id INTO c_legal_just      FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Правовое обоснование')        LIMIT 1;
  SELECT id INTO c_legal_anal      FROM criteria WHERE is_global_template AND LOWER(name) = LOWER('Юридический анализ')          LIMIT 1;

  -- ── 1. Академическое эссе (general) ────────────────────────────────────────
  IF c_argumentation IS NOT NULL AND c_structure IS NOT NULL
     AND c_style IS NOT NULL AND c_depth IS NOT NULL THEN
    items := jsonb_build_array(
      jsonb_build_object('criterion_id', c_argumentation, 'weight', 35),
      jsonb_build_object('criterion_id', c_structure,     'weight', 25),
      jsonb_build_object('criterion_id', c_depth,         'weight', 20),
      jsonb_build_object('criterion_id', c_style,         'weight', 20)
    );
    INSERT INTO rubrics (teacher_id, name, description, subject, items, is_global_template)
    SELECT NULL,
           'Академическое эссе',
           'Базовый набор для эссе и письменных работ: аргументация важнее всего, плюс структура, глубина и стиль.',
           'general',
           items,
           TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM rubrics WHERE is_global_template AND LOWER(name) = LOWER('Академическое эссе')
    );
  END IF;

  -- ── 2. Гуманитарная работа с источниками (humanities) ──────────────────────
  IF c_argumentation IS NOT NULL AND c_sources IS NOT NULL
     AND c_structure IS NOT NULL AND c_depth IS NOT NULL THEN
    items := jsonb_build_array(
      jsonb_build_object('criterion_id', c_argumentation, 'weight', 30),
      jsonb_build_object('criterion_id', c_sources,       'weight', 30),
      jsonb_build_object('criterion_id', c_depth,         'weight', 20),
      jsonb_build_object('criterion_id', c_structure,     'weight', 20)
    );
    INSERT INTO rubrics (teacher_id, name, description, subject, items, is_global_template)
    SELECT NULL,
           'Гуманитарная работа с источниками',
           'Для курсовых и рефератов по гуманитарным наукам — аргументация и работа с литературой на одном уровне.',
           'humanities',
           items,
           TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM rubrics WHERE is_global_template AND LOWER(name) = LOWER('Гуманитарная работа с источниками')
    );
  END IF;

  -- ── 3. Расчётная задача (engineering / STEM) ───────────────────────────────
  IF c_method IS NOT NULL AND c_formulas IS NOT NULL
     AND c_units IS NOT NULL AND c_answer IS NOT NULL AND c_result IS NOT NULL THEN
    items := jsonb_build_array(
      jsonb_build_object('criterion_id', c_method,   'weight', 25),
      jsonb_build_object('criterion_id', c_answer,   'weight', 25),
      jsonb_build_object('criterion_id', c_formulas, 'weight', 20),
      jsonb_build_object('criterion_id', c_units,    'weight', 15),
      jsonb_build_object('criterion_id', c_result,   'weight', 15)
    );
    INSERT INTO rubrics (teacher_id, name, description, subject, items, is_global_template)
    SELECT NULL,
           'Расчётная задача',
           'Для физики, математики и инженерных дисциплин — метод и правильность ответа в приоритете, формулы и единицы дополнительно.',
           'engineering',
           items,
           TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM rubrics WHERE is_global_template AND LOWER(name) = LOWER('Расчётная задача')
    );
  END IF;

  -- ── 4. Бизнес-кейс (business + economics) ──────────────────────────────────
  IF c_situation IS NOT NULL AND c_recommendations IS NOT NULL AND c_economic IS NOT NULL THEN
    items := jsonb_build_array(
      jsonb_build_object('criterion_id', c_situation,       'weight', 35),
      jsonb_build_object('criterion_id', c_recommendations, 'weight', 35),
      jsonb_build_object('criterion_id', c_economic,        'weight', 30)
    );
    INSERT INTO rubrics (teacher_id, name, description, subject, items, is_global_template)
    SELECT NULL,
           'Бизнес-кейс',
           'Для кейсов и проектных заданий — анализ ситуации, рекомендации и финансовое обоснование в равных долях.',
           'business',
           items,
           TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM rubrics WHERE is_global_template AND LOWER(name) = LOWER('Бизнес-кейс')
    );
  END IF;

  -- ── 5. Юридический разбор (law) ────────────────────────────────────────────
  IF c_legal_just IS NOT NULL AND c_legal_anal IS NOT NULL AND c_argumentation IS NOT NULL THEN
    items := jsonb_build_array(
      jsonb_build_object('criterion_id', c_legal_anal,    'weight', 40),
      jsonb_build_object('criterion_id', c_legal_just,    'weight', 40),
      jsonb_build_object('criterion_id', c_argumentation, 'weight', 20)
    );
    INSERT INTO rubrics (teacher_id, name, description, subject, items, is_global_template)
    SELECT NULL,
           'Юридический разбор',
           'Для задач на квалификацию правоотношений — юридический анализ, ссылки на нормы и общая аргументация.',
           'law',
           items,
           TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM rubrics WHERE is_global_template AND LOWER(name) = LOWER('Юридический разбор')
    );
  END IF;
END $$;

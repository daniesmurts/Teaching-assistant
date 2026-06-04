-- Migration 009 — seed STEM (calculation) global rubric templates.
-- Idempotent: only inserts when a platform_admin exists and the template
-- (by name) isn't already present.

DO $$
DECLARE
  admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM teachers WHERE role = 'platform_admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN
    RAISE NOTICE 'No platform_admin yet — skipping STEM template seed';
    RETURN;
  END IF;

  -- Физика — расчётная задача
  IF NOT EXISTS (SELECT 1 FROM rubrics WHERE is_global_template AND name = 'Физика — расчётная задача') THEN
    INSERT INTO rubrics (teacher_id, name, criteria, is_global_template, template_subject)
    VALUES (admin_id, 'Физика — расчётная задача',
      '[{"name":"Правильность ответа","weight":40,"max_score":100,"description":"Итоговый числовой ответ верен с учётом точности"},
        {"name":"Метод решения","weight":30,"max_score":100,"description":"Выбран верный физический закон/подход, логика решения корректна"},
        {"name":"Единицы и размерности","weight":15,"max_score":100,"description":"Правильные единицы измерения, согласованность размерностей"},
        {"name":"Формулы и обоснование","weight":15,"max_score":100,"description":"Корректные формулы, пояснения к ключевым шагам"}]'::jsonb,
      TRUE, 'engineering');
  END IF;

  -- Математика — решение задачи
  IF NOT EXISTS (SELECT 1 FROM rubrics WHERE is_global_template AND name = 'Математика — решение задачи') THEN
    INSERT INTO rubrics (teacher_id, name, criteria, is_global_template, template_subject)
    VALUES (admin_id, 'Математика — решение задачи',
      '[{"name":"Правильность ответа","weight":40,"max_score":100,"description":"Окончательный ответ верен"},
        {"name":"Ход решения","weight":35,"max_score":100,"description":"Логически последовательные и корректные преобразования"},
        {"name":"Полнота обоснования","weight":25,"max_score":100,"description":"Обоснованы переходы, рассмотрены случаи, нет пропущенных шагов"}]'::jsonb,
      TRUE, 'general');
  END IF;

  -- Инженерный расчёт
  IF NOT EXISTS (SELECT 1 FROM rubrics WHERE is_global_template AND name = 'Инженерный расчёт') THEN
    INSERT INTO rubrics (teacher_id, name, criteria, is_global_template, template_subject)
    VALUES (admin_id, 'Инженерный расчёт',
      '[{"name":"Корректность расчёта","weight":40,"max_score":100,"description":"Числовые результаты верны"},
        {"name":"Применение методики","weight":30,"max_score":100,"description":"Использован верный метод/нормативная методика"},
        {"name":"Единицы и точность","weight":15,"max_score":100,"description":"Единицы, значащие цифры, округление"},
        {"name":"Анализ результата","weight":15,"max_score":100,"description":"Проверка правдоподобности, выводы по результату"}]'::jsonb,
      TRUE, 'engineering');
  END IF;
END $$;

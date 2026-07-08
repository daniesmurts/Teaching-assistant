-- Usage counter for the AI "improve description" assist on criteria — new
-- LLM cost surface, needs its own free-tier cap (see planLimits.ts
-- criteriaImprovePerMonth). Same pattern as grades/presentations.

ALTER TABLE usage_counters
  ADD COLUMN IF NOT EXISTS criteria_improve_this_month INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_usage(
  p_teacher_id UUID,
  p_feature    TEXT   -- 'grade' | 'presentation' | 'criteria_improve'
) RETURNS VOID AS $$
DECLARE
  current_month TEXT := TO_CHAR(NOW(), 'YYYY-MM');
BEGIN
  INSERT INTO usage_counters (teacher_id, month_year,
    grades_this_month, presentations_this_month, criteria_improve_this_month)
  VALUES (p_teacher_id, current_month,
    CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'criteria_improve' THEN 1 ELSE 0 END)
  ON CONFLICT (teacher_id) DO UPDATE SET
    grades_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END
      ELSE
        usage_counters.grades_this_month +
        CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END
    END,
    presentations_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END
      ELSE
        usage_counters.presentations_this_month +
        CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END
    END,
    criteria_improve_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'criteria_improve' THEN 1 ELSE 0 END
      ELSE
        usage_counters.criteria_improve_this_month +
        CASE WHEN p_feature = 'criteria_improve' THEN 1 ELSE 0 END
    END,
    month_year = current_month,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

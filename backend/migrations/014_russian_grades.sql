-- Migration 014 — convert existing A–F grades to the Russian 5-point scale.
-- Mapping preserves pass/fail: A→5, B→4, C→3, D→3 (both were passing), F→2 (fail).

UPDATE assignments SET ai_grade = CASE ai_grade
  WHEN 'A' THEN '5' WHEN 'B' THEN '4' WHEN 'C' THEN '3' WHEN 'D' THEN '3' WHEN 'F' THEN '2'
  ELSE ai_grade END
WHERE ai_grade IN ('A', 'B', 'C', 'D', 'F');

UPDATE assignments SET approved_grade = CASE approved_grade
  WHEN 'A' THEN '5' WHEN 'B' THEN '4' WHEN 'C' THEN '3' WHEN 'D' THEN '3' WHEN 'F' THEN '2'
  ELSE approved_grade END
WHERE approved_grade IN ('A', 'B', 'C', 'D', 'F');

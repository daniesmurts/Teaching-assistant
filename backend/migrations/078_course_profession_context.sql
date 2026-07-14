-- Profession context for a course — направление подготовки / кем работают
-- выпускники. Free text rather than a controlled ФГОС vocabulary: teachers
-- describe it in their own words, and the materials/quiz generators fold it
-- into their prompts so generated content is anchored to the target
-- profession instead of the topic alone. See Research.md §8.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS profession_context TEXT;

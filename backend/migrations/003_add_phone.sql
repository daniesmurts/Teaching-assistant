-- Migration 003 — add phone number to teachers
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS phone TEXT;

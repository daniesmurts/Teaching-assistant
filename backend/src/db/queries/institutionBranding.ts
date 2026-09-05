import { pool } from '../connection'

// Фирменный стиль учебного заведения (migration 125) — what a generated deck
// should look like when it leaves the platform: the university's accent colour
// and its logo on the титульный лист, instead of ИСПУМ's own amber.

export interface InstitutionBranding {
  institution_id: string
  name:           string
  accent_color:   string | null   // '#RRGGBB'
  logo_path:      string | null
  logo_mime:      string | null
}

export async function getInstitutionBranding(institutionId: string): Promise<InstitutionBranding | null> {
  const { rows } = await pool.query<InstitutionBranding>(
    `SELECT id AS institution_id, name,
            brand_accent_color AS accent_color,
            brand_logo_path    AS logo_path,
            brand_logo_mime    AS logo_mime
       FROM institutions WHERE id = $1`,
    [institutionId]
  )
  return rows[0] ?? null
}

export async function setInstitutionAccentColor(institutionId: string, color: string | null): Promise<void> {
  await pool.query('UPDATE institutions SET brand_accent_color = $2 WHERE id = $1', [institutionId, color])
}

export async function setInstitutionLogo(
  institutionId: string,
  logoPath: string | null,
  mime: string | null,
): Promise<void> {
  await pool.query(
    'UPDATE institutions SET brand_logo_path = $2, brand_logo_mime = $3 WHERE id = $1',
    [institutionId, logoPath, mime]
  )
}

/**
 * The branding to apply to a deck this teacher exports — null for a teacher
 * with no institution, which is the individual-tier case and keeps the
 * platform's own look.
 */
export async function getBrandingForTeacher(teacherId: string): Promise<InstitutionBranding | null> {
  const { rows } = await pool.query<InstitutionBranding>(
    `SELECT i.id AS institution_id, i.name,
            i.brand_accent_color AS accent_color,
            i.brand_logo_path    AS logo_path,
            i.brand_logo_mime    AS logo_mime
       FROM teachers t
       JOIN institutions i ON i.id = t.institution_id
      WHERE t.id = $1`,
    [teacherId]
  )
  return rows[0] ?? null
}

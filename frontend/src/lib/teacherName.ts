/**
 * Russian academic convention: «Полное имя» on registration is entered as
 * «Фамилия Имя Отчество» (family name first). For a respectful in-app greeting
 * we want «Имя Отчество», not the family name — naive first-word extraction
 * (`name.split(' ')[0]`) would pick «Фамилия».
 *
 *   3+ words → words 1 + 2 ("Иван Петрович")
 *   2 words  → word 1 (assume «Фамилия Имя» order → take Имя)
 *   1 word   → that word
 *
 * Backend mirror lives at backend/src/services/email.ts ::extractSignatureName.
 */
export function nameForGreeting(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length >= 3) return `${parts[1]} ${parts[2]}`
  if (parts.length === 2) return parts[1]
  return parts[0]
}

/**
 * Two-letter initials for the avatar circle, following the same convention as
 * `nameForGreeting`. For «Салин Иван Петрович» returns «ИП» (Имя + Отчество),
 * not «СИ» (Фамилия + Имя). Falls back gracefully for shorter inputs.
 */
export function initialsForAvatar(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const first = (s: string) => (s[0] ?? '').toUpperCase()
  if (parts.length >= 3) return first(parts[1]) + first(parts[2])
  if (parts.length === 2) return first(parts[1])    // Имя only — single letter is fine
  return first(parts[0]) + (parts[0][1] ?? '').toUpperCase()   // 1 word: first two letters
}

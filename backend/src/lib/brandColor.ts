/**
 * A brand colour has to survive two hostile consumers: pptxgenjs, which wants
 * a bare six-digit hex and silently produces a corrupt package for anything
 * else, and pdfkit, which wants a leading '#'. Neither validates. So the
 * value is normalised once, here, at the point it enters the system.
 *
 * Accepts '#RRGGBB', 'RRGGBB' and the three-digit shorthand; returns the
 * canonical '#RRGGBB', or null for anything else — including the empty string,
 * which is how the settings form says "back to the platform default".
 */
export function normaliseBrandColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim().replace(/^#/, '')

  const expanded = /^[0-9a-fA-F]{3}$/.test(raw)
    ? raw.split('').map((c) => c + c).join('')
    : raw

  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toUpperCase()}` : null
}

/** pptxgenjs wants the hex without '#'. */
export function toPptxColor(color: string): string {
  return color.replace(/^#/, '')
}

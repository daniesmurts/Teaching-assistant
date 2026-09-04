# Vendored fonts

Server-side PDF generation (pdfkit) embeds these directly — there is no system
font stack to fall back on inside the container, and no network fetch at render
time.

## PT Serif / PT Sans — the house faces

Used by `programReportPdf.ts`, `fosReportPdf.ts` and the presentation handout.
Cyrillic-native and visually matched to the web app.

**They carry almost no Greek.** Verified glyph by glyph against all four files:
of `α–ω` and `Α–Ω` only `Δ`, `Ω`, `μ` and `π` are present, and `∇`/`→` are
missing too. pdfkit draws a missing glyph as a tofu box with no warning, so
`P = ρgQH` silently printed as `P = ⌷gQH` in every formula until this was
caught by rendering a handout and looking at it.

## DejaVu Sans / DejaVu Serif — the fallback for formulas

Covers Latin, Cyrillic, the full Greek alphabet, the math operators
`∑ ∫ ∂ ∇ ≈ ≤ ≥ √ ∞ →`, and sub/superscript digits — the exact set
`presentationExport.ts`'s `latexToPlainText()` can emit.

`presentationHandoutPdf.ts` switches to the DejaVu face of the same weight for
any paragraph containing a character PT cannot draw, so a formula renders as
`P = ρgQH` while ordinary Russian prose stays in PT. Both families are
humanist enough that the swap reads as a change of texture, not of document.

Licence: Bitstream Vera + Arev, permissive, redistribution allowed with the
notice — see `DejaVu-LICENSE.txt`. Sourced from `dejavu-fonts-ttf@2.37.3`.

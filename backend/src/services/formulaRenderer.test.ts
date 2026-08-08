import { describe, it, expect } from 'vitest'
import { renderFormulaToPng } from './formulaRenderer'

// The first render in this file pays a one-time MathJax document/adaptor
// init cost (cached afterwards via texToSvgPromise) — under full-suite
// parallel load that can push either of the first two tests past vitest's
// default 5s timeout, so all three get a generous explicit one.
const RENDER_TIMEOUT_MS = 20_000

describe('renderFormulaToPng', () => {
  it('renders a simple formula to a non-empty PNG data URI with a sane aspect ratio', async () => {
    const result = await renderFormulaToPng('P = \\rho g Q H', '#1A1A1A')
    expect(result).not.toBeNull()
    expect(result!.dataUri).toMatch(/^data:image\/png;base64,/)
    expect(result!.dataUri.length).toBeGreaterThan(100)
    expect(result!.aspect).toBeGreaterThan(1)
  }, RENDER_TIMEOUT_MS)

  it('renders a formula with \\left/\\right, \\overline and nested \\frac (the RANS momentum equation)', async () => {
    const latex = String.raw`\rho \frac{DU_i}{Dt} = -\frac{\partial P}{\partial x_i} + \frac{\partial}{\partial x_j}\left[\mu\left(\frac{\partial U_i}{\partial x_j}+\frac{\partial U_j}{\partial x_i}\right)-\rho\overline{u_i'u_j'}\right]+\rho g_i`
    const result = await renderFormulaToPng(latex, '#1A1A1A')
    expect(result).not.toBeNull()
    expect(result!.dataUri).toMatch(/^data:image\/png;base64,/)
  }, RENDER_TIMEOUT_MS)

  it('renders malformed LaTeX as an error indicator rather than throwing (MathJax is lenient)', async () => {
    // MathJax renders unparseable TeX as a red error box in the SVG instead
    // of throwing — renderFormulaToPng() only returns null on an actual
    // failure (e.g. the packages missing), so this documents that a
    // malformed formula still produces *something* export-safe.
    const result = await renderFormulaToPng('\\frac{', '#1A1A1A')
    expect(result).not.toBeNull()
  }, RENDER_TIMEOUT_MS)
})

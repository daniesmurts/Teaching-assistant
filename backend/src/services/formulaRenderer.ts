import { logger } from '../lib/logger'

// Renders LaTeX formulas to PNG for the PPTX export (presentationExport.ts).
// pptxgenjs has no math typesetting of its own, so this gives the exported
// deck the same visual formulas as the KaTeX-rendered web viewer
// (frontend/src/components/presentations/Math.tsx) instead of the Unicode
// flattening in latexToPlainText(), which stays as the fallback below.
//
// Pipeline: MathJax (headless, pure JS — no browser/DOM needed) renders TeX
// to SVG, then @resvg/resvg-js rasterises that SVG to PNG. Both run once per
// process; the MathJax document is built lazily and cached.

export interface RenderedFormula {
  dataUri: string   // data:image/png;base64,...
  aspect: number     // width / height of the formula, for sizing on the slide
}

type TexToSvg = (latex: string) => string

let texToSvgPromise: Promise<TexToSvg> | null = null

async function getTexToSvg(): Promise<TexToSvg> {
  if (!texToSvgPromise) {
    texToSvgPromise = (async () => {
      const { mathjax } = await import('mathjax-full/js/mathjax.js')
      const { TeX } = await import('mathjax-full/js/input/tex.js')
      const { SVG } = await import('mathjax-full/js/output/svg.js')
      const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js')
      const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js')
      const { AllPackages } = await import('mathjax-full/js/input/tex/AllPackages.js')

      const adaptor = liteAdaptor()
      RegisterHTMLHandler(adaptor)
      const tex = new TeX({ packages: AllPackages })
      const svgOutput = new SVG({ fontCache: 'none' })
      const doc = mathjax.document('', { InputJax: tex, OutputJax: svgOutput })

      return (latex: string) => {
        // doc.convert() returns an <mjx-container> wrapper; the actual <svg>
        // element resvg needs is its first child.
        const container = doc.convert(latex, { display: true })
        const svgNode = adaptor.firstChild(container)
        return adaptor.outerHTML(svgNode as never)
      }
    })()
  }
  return texToSvgPromise
}

// MathJax's SVG reports its own size as width="N.NNNex" / height="N.NNNex" —
// convert that to a target raster width so bigger formulas (e.g. a stacked
// \frac-heavy equation) render at proportionally higher resolution instead
// of a fixed canvas stretching/blurring them.
const PX_PER_EX = 90
const MIN_RASTER_W = 300
const MAX_RASTER_W = 4000

function parseExAttr(svg: string, attr: 'width' | 'height'): number {
  const m = svg.match(new RegExp(`${attr}="([\\d.]+)ex"`))
  return m ? parseFloat(m[1]) : 0
}

/**
 * Renders a single LaTeX formula (no surrounding $ delimiters) to a PNG data
 * URI. Returns null on any failure — MathJax parse error, resvg failure, or
 * the packages not being installed yet — so the caller can fall back to
 * latexToPlainText() rather than the export failing outright.
 */
export async function renderFormulaToPng(latex: string, colorHex: string): Promise<RenderedFormula | null> {
  try {
    const texToSvg = await getTexToSvg()
    let svg = texToSvg(latex)

    const w = parseExAttr(svg, 'width')
    const h = parseExAttr(svg, 'height')
    if (!w || !h) return null

    // MathJax's SVG paths use fill="currentColor" / stroke="currentColor",
    // relying on CSS cascade in a browser. resvg has no such cascade, so
    // resolve it explicitly via SVG's own `color` presentation attribute
    // (the spec-defined source for currentColor) on the root element.
    svg = svg.replace('<svg ', `<svg color="${colorHex}" `)

    const { Resvg } = await import('@resvg/resvg-js')
    const rasterW = Math.max(MIN_RASTER_W, Math.min(MAX_RASTER_W, Math.round(w * PX_PER_EX)))
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: rasterW },
      background: 'rgba(255,255,255,0)',
    })
    const png = resvg.render().asPng()

    return { dataUri: `data:image/png;base64,${png.toString('base64')}`, aspect: w / h }
  } catch (err) {
    logger.warn({ message: '[PPTX export] formula-to-PNG render failed, falling back to plain text', latex, error: (err as Error).message })
    return null
  }
}

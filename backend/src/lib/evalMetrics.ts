// Agreement metrics for the eval harness. Pure functions — no I/O.
//
// QWK (quadratic weighted kappa) is the standard automated-essay-scoring
// agreement metric; MAE and Spearman support the 0–100 score comparison.

/**
 * Quadratic Weighted Kappa over two equal-length label sequences.
 * Labels can be any ordinal numbers (e.g. grades 2..5). Returns a value in
 * [-1, 1]; 1 = perfect agreement, 0 = chance-level, negative = worse than chance.
 */
export function quadraticWeightedKappa(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error('QWK requires two non-empty sequences of equal length')
  }

  // Category set = union of observed labels, ordered.
  const cats = Array.from(new Set([...a, ...b])).sort((x, y) => x - y)
  const n = cats.length
  if (n === 1) return 1   // total agreement on a single category

  const idx = new Map(cats.map((c, i) => [c, i]))

  // Observed matrix + marginal histograms
  const observed = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const histA = new Array<number>(n).fill(0)
  const histB = new Array<number>(n).fill(0)
  for (let i = 0; i < a.length; i++) {
    const ia = idx.get(a[i])!
    const ib = idx.get(b[i])!
    observed[ia][ib] += 1
    histA[ia] += 1
    histB[ib] += 1
  }

  // Quadratic weights + expected matrix from marginals
  let numerator = 0
  let denominator = 0
  const total = a.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const weight = ((i - j) ** 2) / ((n - 1) ** 2)
      const expected = (histA[i] * histB[j]) / total
      numerator += weight * observed[i][j]
      denominator += weight * expected
    }
  }

  if (denominator === 0) return 1
  return 1 - numerator / denominator
}

export function meanAbsoluteError(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error('MAE requires two non-empty sequences of equal length')
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** Spearman rank correlation (with average-rank tie handling). */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) {
    throw new Error('Spearman requires two sequences of equal length ≥ 2')
  }
  const ra = ranks(a)
  const rb = ranks(b)
  return pearson(ra, rb)
}

function ranks(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i }))
  indexed.sort((p, q) => p.v - q.v)
  const out = new Array<number>(xs.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++
    const avgRank = (i + j) / 2 + 1   // 1-based average rank for the tie group
    for (let k = i; k <= j; k++) out[indexed[k].i] = avgRank
    i = j + 1
  }
  return out
}

function pearson(a: number[], b: number[]): number {
  const n = a.length
  const meanA = a.reduce((s, v) => s + v, 0) / n
  const meanB = b.reduce((s, v) => s + v, 0) / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov  += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return varA === varB ? 1 : 0
  return cov / Math.sqrt(varA * varB)
}

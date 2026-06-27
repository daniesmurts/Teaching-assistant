// Minimal shim for `katex` covering the API surface we use. Kept only because
// the sandbox running these edits couldn't reach npm to install @types/katex
// — once you `npm install` in the frontend workspace the real @types/katex
// (already declared in devDependencies) will provide a complete definition
// and you can delete this file.

declare module 'katex' {
  export interface KatexOptions {
    displayMode?:  boolean
    throwOnError?: boolean
    errorColor?:   string
    strict?:       boolean | 'ignore' | 'warn' | 'error' | ((errorCode: string) => string)
    output?:       'html' | 'mathml' | 'htmlAndMathml'
  }
  export function renderToString(latex: string, options?: KatexOptions): string
  const katex: { renderToString: typeof renderToString }
  export default katex
}

declare module 'katex/dist/katex.min.css'

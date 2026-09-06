import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ─── Guard: never shadow a CommonJS module binding ───────────────────────────
//
// The backend compiles to CommonJS (tsconfig "module": "commonjs"), so tsc
// rewrites every reference to this module's own exported bindings as
// `exports.Foo`. Declaring a local called `exports` therefore puts that
// rewritten reference in a temporal dead zone, and the function throws
// "Cannot access 'exports' before initialization" — at runtime, in the built
// image, on a line the author never wrote.
//
// This reached production on 2026-09-06 (getArtifactUsage in
// db/queries/artifactUsage.ts, which read the module's own exported
// ARTIFACT_UNION_SQL and declared `const exports` further down). Nothing
// caught it: tsc compiles it happily, and vitest runs the TypeScript source
// through esbuild, so no test ever executes the CommonJS emit that breaks.
//
// A static check is the cheap guard. The expensive one — running the compiled
// output — is worth building the day this class of bug returns despite this.
//
// Comments are stripped before matching: this very file has to describe the
// bug in prose, and so will the next person who documents it. A guard that
// trips on its own explanation would get special-cased and then ignored.

const RESERVED = ['exports', 'module', 'require', '__dirname', '__filename']
const DECLARATION = new RegExp(`\\b(?:const|let|var)\\s+(${RESERVED.join('|')})\\b`, 'g')

/** Crude but sufficient: a comment mentioning the pattern is not a declaration of it. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[^\n]*?\/\/[^\n]*$/gm, (line) => line.slice(0, line.indexOf('//')))
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(path)
  }
  return found
}

describe('CommonJS module bindings are never shadowed', () => {
  it('declares no local named exports/module/require/__dirname/__filename', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(join(__dirname))) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(DECLARATION)) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${file.replace(__dirname, 'src')}:${line} — declares '${match[1]}'`)
      }
    }

    expect(offenders).toEqual([])
  })
})

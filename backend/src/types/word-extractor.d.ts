// word-extractor ships no type declarations. Minimal shim for the surface we use.
declare module 'word-extractor' {
  export interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): string
    getTextboxes?(): string[]
  }

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>
  }
}

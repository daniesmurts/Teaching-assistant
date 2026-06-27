// Rich clipboard write — pushes both text/html and text/plain so paste
// targets that understand HTML (PowerPoint, Word, Google Slides, Notion,
// Word Online, Pages) embed images, tables, lists; targets that don't
// (terminals, plain editors) fall back to the text we already render.
//
// ClipboardItem isn't on every browser/permission combination, so we
// degrade to writeText on any failure rather than swallowing the copy.

export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html':  new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return true
    }
  } catch {
    // Permission denied, unsupported mime, etc. — fall through.
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

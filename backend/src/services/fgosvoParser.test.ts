import { describe, it, expect } from 'vitest'
import { parseCategoryLinks, parsePageLevel, parseDirectionRows } from './fgosvoParser'

const BASE_TOP = 'https://fgosvo.ru/fgosvo/index/24'
const BASE_CAT = 'https://fgosvo.ru/fgosvo/index/24/29'

// Excerpts of real markup fetched from fgosvo.ru (verified 2026-07-22) —
// trimmed to a couple of rows, whitespace/structure otherwise untouched.
const TOP_PAGE = `
<!doctype html><html><head>
<title>ФГОС ВО (3++) по направлениям бакалавриата</title>
</head><body>
<h2>ФГОС ВО (3++) по направлениям бакалавриата</h2>
<div id="w0" class="list-view">
<div class="item d-flex" data-key="28"><div class="w112 text-green align-middle"><span class="icons openbook align-middle me-2"></span>010000</div>
<div>
    <a class="item-link" href="/fgosvo/index/24/28" data-pjax="0">МАТЕМАТИКА И МЕХАНИКА</a></div>

</div>
<div class="item d-flex" data-key="29"><div class="w112 text-green align-middle"><span class="icons openbook align-middle me-2"></span>020000</div>
<div>
    <a class="item-link" href="/fgosvo/index/24/29" data-pjax="0">КОМПЬЮТЕРНЫЕ И ИНФОРМАЦИОННЫЕ НАУКИ</a></div>

</div>
</div>
</body></html>`

const CATEGORY_PAGE = `
<!doctype html><html><body>
<div class="item d-flex" data-key="1583">    <div class="d-flex">
        <div class="w80 me-2">02.03.01</div>
        <div>
            <div><span class="icons googledocs align-middle"></span>Математика и компьютерные науки</div>
                            <div class="text-darkgrey">
                    <a class="text-darkgrey" href="/fgosvo/downloads?f=%2Fuploadfiles%2FFGOS+VO+3%2B%2B%2FBak%2F020301_B_3_15062021.pdf&amp;id=1583" data-pjax="0" target="_blank">PDF, 176.57 КБ</a><span>, 15.01.2022</span>
                                    </div>
                                </div>
    </div>
</div>
<div class="item d-flex" data-key="1584">    <div class="d-flex">
        <div class="w80 me-2">02.03.02</div>
        <div>
            <div><span class="icons googledocs align-middle"></span>Фундаментальные информатика и информационные технологии</div>
                            <div class="text-darkgrey">
                    <a class="text-darkgrey" href="/fgosvo/downloads?f=%2Fuploadfiles%2FFGOS+VO+3%2B%2B%2FBak%2F020302_B_3_15062021.pdf&amp;id=1584" data-pjax="0" target="_blank">PDF, 197.44 КБ</a><span>, 15.01.2022</span>
                                    </div>
                                </div>
    </div>
</div>
</body></html>`

// A row with no PDF link yet (e.g. a draft/withdrawn standard) — must be
// skipped, not guessed at.
const CATEGORY_PAGE_MISSING_PDF = `
<div class="item d-flex" data-key="9999">    <div class="d-flex">
        <div class="w80 me-2">99.03.99</div>
        <div>
            <div><span class="icons googledocs align-middle"></span>Без документа</div>
        </div>
    </div>
</div>`

describe('parseCategoryLinks', () => {
  it('extracts every category link with its code and title', () => {
    const links = parseCategoryLinks(TOP_PAGE, BASE_TOP)
    expect(links).toEqual([
      { url: 'https://fgosvo.ru/fgosvo/index/24/28', title: 'МАТЕМАТИКА И МЕХАНИКА', code: '010000' },
      { url: 'https://fgosvo.ru/fgosvo/index/24/29', title: 'КОМПЬЮТЕРНЫЕ И ИНФОРМАЦИОННЫЕ НАУКИ', code: '020000' },
    ])
  })

  it('returns an empty list for a page with no item blocks', () => {
    expect(parseCategoryLinks('<html><body>nothing here</body></html>', BASE_TOP)).toEqual([])
  })
})

describe('parsePageLevel', () => {
  it('guesses бакалавриат from the page title', () => {
    expect(parsePageLevel(TOP_PAGE)).toBe('бакалавриат')
  })

  it('guesses магистратура from a different heading', () => {
    expect(parsePageLevel('<title>ФГОС ВО (3++) по направлениям магистратуры</title>')).toBe('магистратура')
  })

  it('returns null when nothing matches', () => {
    expect(parsePageLevel('<title>Какая-то другая страница</title>')).toBeNull()
  })
})

describe('parseDirectionRows', () => {
  it('extracts code, name, pdf url, and date for every row', () => {
    const rows = parseDirectionRows(CATEGORY_PAGE, BASE_CAT)
    expect(rows).toEqual([
      {
        code: '02.03.01',
        name: 'Математика и компьютерные науки',
        pdf_url: 'https://fgosvo.ru/fgosvo/downloads?f=%2Fuploadfiles%2FFGOS+VO+3%2B%2B%2FBak%2F020301_B_3_15062021.pdf&id=1583',
        order_date: '15.01.2022',
      },
      {
        code: '02.03.02',
        name: 'Фундаментальные информатика и информационные технологии',
        pdf_url: 'https://fgosvo.ru/fgosvo/downloads?f=%2Fuploadfiles%2FFGOS+VO+3%2B%2B%2FBak%2F020302_B_3_15062021.pdf&id=1584',
        order_date: '15.01.2022',
      },
    ])
  })

  it('decodes the &amp; entity in the pdf href', () => {
    const rows = parseDirectionRows(CATEGORY_PAGE, BASE_CAT)
    expect(rows[0].pdf_url).not.toContain('&amp;')
    expect(rows[0].pdf_url).toContain('&id=1583')
  })

  it('skips a row with no pdf link', () => {
    expect(parseDirectionRows(CATEGORY_PAGE_MISSING_PDF, BASE_CAT)).toEqual([])
  })
})

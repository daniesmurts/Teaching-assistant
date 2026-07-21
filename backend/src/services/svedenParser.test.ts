import { describe, it, expect } from 'vitest'
import {
  parseSvedenPage, selectProgramRow, matchDiscipline, classifyPracticeType, normalizeName, cleanLinkText,
} from './svedenParser'

const BASE = 'https://www.example-uni.ru/sveden/education'

// A representative sveden table: mandated itemprop markup, two programmes,
// РПД + Аннотации columns with IDENTICAL discipline-name link texts (the
// collision the cell-hint logic exists for), a practices column, and the
// header-style «Рабочая_программа» archive link.
const PAGE = `
<html><body><table>
<tr>
  <td itemprop="eduCode">01.03.02</td>
  <td itemprop="eduName">Прикладная математика и информатика</td>
  <td><a itemprop="opMain" href="/docs/opmain1.pdf">Описание ООП_</a></td>
  <td><a itemprop="educationPlan" href="/docs/plan1.pdf">Учебный план ООП_</a></td>
  <td itemprop="educationRpd">
    <a href="/docs/rpd_all.zip">Рабочая_программа</a>
    <a href="/docs/rpd1.pdf">Линейная_алгебра</a>
    <a href="/docs/rpd2.pdf">Математический_анализ</a>
    <a href="/docs/rpd3.pdf">Учебная практика (технологическая (проектно-технологическая) практика)</a>
  </td>
  <td itemprop="educationAnnotation">
    <a href="/docs/ann1.pdf">Линейная_алгебра</a>
    <a href="/docs/ann2.pdf">Математический_анализ</a>
  </td>
  <td><a itemprop="educationShedule" href="/docs/sched1.pdf">Календарный учебный график_</a></td>
  <td>
    <a href="/docs/pr1.pdf">Производственная практика (преддипломная практика)</a>
    <a href="/docs/pr2.pdf">Производственная практика (технологическая (проектно-технологическая) практика)</a>
  </td>
</tr>
<tr>
  <td itemprop="eduCode">09.03.03</td>
  <td itemprop="eduName">Прикладная информатика</td>
  <td itemprop="educationRpd"><a href="/docs/rpd9.pdf">Базы_данных</a></td>
</tr>
</table></body></html>`

describe('parseSvedenPage', () => {
  const { rows, availableYears, selectedYear } = parseSvedenPage(PAGE, BASE)

  it('reports no multi-year tabs for an ordinary single-year page', () => {
    expect(availableYears).toEqual([])
    expect(selectedYear).toBeNull()
  })

  it('finds both programme rows with codes and names', () => {
    expect(rows).toHaveLength(2)
    expect(rows[0].code).toBe('01.03.02')
    expect(rows[0].name).toBe('Прикладная математика и информатика')
    expect(rows[1].code).toBe('09.03.03')
  })

  it('classifies РПД links via the cell itemprop and undoes underscores', () => {
    const rpd = rows[0].docs.filter((d) => d.kind === 'working_programme')
    expect(rpd.map((d) => d.text)).toEqual(['Линейная алгебра', 'Математический анализ'])
    expect(rpd[0].url).toBe('https://www.example-uni.ru/docs/rpd1.pdf')
  })

  it('keeps annotation links out of the РПД bucket despite identical texts', () => {
    const ann = rows[0].docs.filter((d) => d.kind === 'annotation')
    expect(ann).toHaveLength(2)
  })

  it('demotes the header-style «Рабочая_программа» archive link to other', () => {
    const other = rows[0].docs.filter((d) => d.kind === 'other')
    expect(other.map((d) => d.text)).toContain('Рабочая программа')
  })

  it('classifies практики by text even inside the РПД cell', () => {
    const pr = rows[0].docs.filter((d) => d.kind === 'practice')
    expect(pr).toHaveLength(3)
    const byText = new Map(pr.map((d) => [d.text, d.practice_type]))
    expect(byText.get('Производственная практика (преддипломная практика)')).toBe('production_pre_diploma')
    expect(byText.get('Производственная практика (технологическая (проектно-технологическая) практика)')).toBe('production_technological')
    // Учебная технологическая must NOT silently map to a production type.
    expect(byText.get('Учебная практика (технологическая (проектно-технологическая) практика)')).toBeNull()
  })

  it('classifies план / описание / график into informational kinds', () => {
    const kinds = new Map(rows[0].docs.map((d) => [d.text, d.kind]))
    expect(kinds.get('Описание ООП')).toBe('description')
    expect(kinds.get('Учебный план ООП')).toBe('plan')
    expect(kinds.get('Календарный учебный график')).toBe('schedule')
  })

  it('falls back to text/href heuristics when no itemprop markup exists', () => {
    const bare = `
      <table><tr>
        <td>38.03.01</td><td>Экономика</td>
        <td><a href="/files/uchebnyi_plan.pdf">Учебный план</a></td>
        <td><a href="/getpilot?id=123">Микроэкономика</a></td>
      </tr></table>`
    const { rows: r } = parseSvedenPage(bare, BASE)
    expect(r).toHaveLength(1)
    expect(r[0].code).toBe('38.03.01')
    const kinds = new Map(r[0].docs.map((d) => [d.text, d.kind]))
    expect(kinds.get('Учебный план')).toBe('plan')
    expect(kinds.get('Микроэкономика')).toBe('working_programme')
  })

  it('ignores script/style content and non-http links', () => {
    const noisy = `
      <script>var a = '<tr><td><a href="/fake.pdf">Фейк 01.01.01</a></td></tr>'</script>
      <table><tr><td itemprop="eduCode">01.03.02</td>
      <td itemprop="educationRpd"><a href="javascript:void(0)">Плохая</a><a href="/ok.pdf">Физика</a></td></tr></table>`
    const { rows: r } = parseSvedenPage(noisy, BASE)
    expect(r).toHaveLength(1)
    expect(r[0].docs.map((d) => d.text)).toEqual(['Физика'])
  })

  // Real kstu.ru markup wraps eduCode/eduName/link-itemprop on an inner
  // <span>, not on the <td> or <a> itself — verified against the actual
  // downloaded page during implementation. This is the exact shape.
  it('reads eduCode/eduName and link itemprop from a wrapping <span> (real kstu.ru shape)', () => {
    const real = `<table><tr>
      <td rowspan="1"><span itemprop="eduCode" title="УП:0"><b>01.03.02</b></span></td>
      <td rowspan="1"><span itemprop="eduName">Прикладная математика и информатика</span></td>
      <td itemprop="educationRpd">
        <span style="white-space:nowrap" itemprop="educationRpd"><a style="color:blue" href="/getpilot?id=1">Алгебра_и_геометрия</a></span><br>
        <span style="white-space:nowrap" itemprop="methodology"><a href="/getpilot?id=2">Metod_KR(KP)_KNITU_pdf эцп.pdf</a></span>
      </td>
    </tr></table>`
    const { rows } = parseSvedenPage(real, BASE)
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBe('01.03.02')
    expect(rows[0].name).toBe('Прикладная математика и информатика')
    const kinds = new Map(rows[0].docs.map((d) => [d.text, d.kind]))
    expect(kinds.get('Алгебра и геометрия')).toBe('working_programme')
    // The methodology-column PDF must NOT be swept into working_programme —
    // it would otherwise show up as a fake, unmatchable РПД in the checklist.
    expect(kinds.get('Metod KR(KP) KNITU pdf эцп.pdf')).toBe('other')
  })

  // A real pilot university (kstu.ru) bundles ALL years' programmes into
  // one response behind client-side tabs, with panels in a DIFFERENT order
  // than the tab buttons (2021→2026 in the DOM, but the 2026 tab shown
  // first/active) — parsing the whole document would silently mix years,
  // and "first row wins" would pick the OLDEST year, not the current one.
  it('scopes to one year panel on a multi-year page, defaulting to the active tab', () => {
    const multiYear = `<html><body>
      <div class="tab-content">
        <div class="tab-pane nn_tabs-pane fade" id="2021" role="tabpanel">
          <table><tr><td itemprop="eduCode">01.03.02</td>
          <td itemprop="educationRpd"><a href="/2021/a.pdf">Старый_курс</a></td></tr></table>
        </div>
        <div class="tab-pane nn_tabs-pane active fade in" id="2026" role="tabpanel">
          <table><tr><td itemprop="eduCode">01.03.02</td>
          <td itemprop="educationRpd"><a href="/2026/b.pdf">Новый_курс</a></td></tr></table>
        </div>
      </div>
    </body></html>`

    const auto = parseSvedenPage(multiYear, BASE)
    expect(auto.availableYears).toEqual(['2026', '2021'])
    expect(auto.selectedYear).toBe('2026')
    expect(auto.rows[0].docs.map((d) => d.text)).toEqual(['Новый курс'])

    const explicit = parseSvedenPage(multiYear, BASE, '2021')
    expect(explicit.selectedYear).toBe('2021')
    expect(explicit.rows[0].docs.map((d) => d.text)).toEqual(['Старый курс'])

    // An unmatched requested year falls back to the active tab, not silence.
    const unmatched = parseSvedenPage(multiYear, BASE, '1999')
    expect(unmatched.selectedYear).toBe('2026')
  })
})

describe('selectProgramRow', () => {
  const { rows } = parseSvedenPage(PAGE, BASE)

  it('selects by направление code', () => {
    const row = selectProgramRow(rows, { code: '09.03.03', name: 'Другое имя' })
    expect(row?.code).toBe('09.03.03')
  })

  it('extracts the code from a longer programme-code string', () => {
    const row = selectProgramRow(rows, { code: '01.03.02 Прикладная математика', name: 'x' })
    expect(row?.code).toBe('01.03.02')
  })

  it('falls back to name match when the code is absent', () => {
    const row = selectProgramRow(rows, { code: null, name: 'Прикладная информатика' })
    expect(row?.code).toBe('09.03.03')
  })

  it('returns null when nothing disambiguates', () => {
    expect(selectProgramRow(rows, { code: null, name: 'Совсем другая программа' })).toBeNull()
  })

  // Real kstu.ru data: code 01.03.02 splits into several рядов sharing the
  // EXACT same eduCode and eduName, one per профиль (eduProf), each with its
  // own document set. Picking "the first" here silently imports the wrong
  // профиль's РПД under the right-looking programme name — must disambiguate
  // via профиль/name or refuse, never guess.
  describe('multi-профиль code (verified against a real pilot university)', () => {
    const multiProfile = `<table>
      <tr>
        <td itemprop="eduCode">01.03.02</td>
        <td itemprop="eduName">Прикладная математика и информатика</td>
        <td itemprop="eduProf">Прикладная математика и информатика</td>
        <td itemprop="educationRpd"><a href="/pmi1.pdf">Алгебра</a></td>
      </tr>
      <tr>
        <td itemprop="eduCode">01.03.02</td>
        <td itemprop="eduName">Прикладная математика и информатика</td>
        <td itemprop="eduProf">Искусственный интеллект и большие данные</td>
        <td itemprop="educationRpd"><a href="/ai1.pdf">Машинное обучение</a></td>
      </tr>
    </table>`
    const { rows: multiRows } = parseSvedenPage(multiProfile, BASE)

    it('resolves uniquely when the programme name matches one профиль exactly', () => {
      const row = selectProgramRow(multiRows, {
        code: '01.03.02', name: 'Искусственный интеллект и большие данные',
      })
      expect(row?.profile).toBe('Искусственный интеллект и большие данные')
      expect(row?.docs[0].text).toBe('Машинное обучение')
    })

    it('also resolves uniquely when the name matches the "base" профиль, which legitimately shares the eduName text', () => {
      const row = selectProgramRow(multiRows, {
        code: '01.03.02', name: 'Прикладная математика и информатика',
      })
      expect(row?.profile).toBe('Прикладная математика и информатика')
      expect(row?.docs[0].text).toBe('Алгебра')
    })

    it('refuses to guess when the name matches neither профиль but matches the shared eduName both rows carry', () => {
      const ambiguous = `<table>
        <tr>
          <td itemprop="eduCode">01.03.02</td>
          <td itemprop="eduName">Прикладная математика и информатика</td>
          <td itemprop="eduProf">Профиль А</td>
          <td itemprop="educationRpd"><a href="/a.pdf">Алгебра</a></td>
        </tr>
        <tr>
          <td itemprop="eduCode">01.03.02</td>
          <td itemprop="eduName">Прикладная математика и информатика</td>
          <td itemprop="eduProf">Профиль Б</td>
          <td itemprop="educationRpd"><a href="/b.pdf">Геометрия</a></td>
        </tr>
      </table>`
      const { rows: ambiguousRows } = parseSvedenPage(ambiguous, BASE)
      // Matches eduName on BOTH rows, neither профиль — genuinely ambiguous.
      const row = selectProgramRow(ambiguousRows, {
        code: '01.03.02', name: 'Прикладная математика и информатика',
      })
      expect(row).toBeNull()
    })

    it('refuses to guess when the name matches nothing at all', () => {
      const row = selectProgramRow(multiRows, { code: '01.03.02', name: 'Совсем другое' })
      expect(row).toBeNull()
    })
  })
})

describe('matchDiscipline', () => {
  const disciplines = [
    { id: 'a', name: 'Линейная алгебра' },
    { id: 'b', name: 'Математический анализ' },
    { id: 'c', name: 'Функциональный анализ' },
    { id: 'd', name: 'Тёория вероятностей' },
  ]

  it('matches exactly after normalization (case, ё, underscores)', () => {
    expect(matchDiscipline('ЛИНЕЙНАЯ_АЛГЕБРА', disciplines)).toEqual({ id: 'a', confidence: 'exact' })
    expect(matchDiscipline('Теория вероятностей', disciplines)).toEqual({ id: 'd', confidence: 'exact' })
  })

  it('does not resolve ambiguous shared-token names', () => {
    // «Анализ данных» shares one token with both анализ disciplines — no guess.
    expect(matchDiscipline('Анализ данных', disciplines)).toBeNull()
  })

  it('fuzzy-matches a clear winner', () => {
    expect(matchDiscipline('Линейная алгебра и геометрия', [
      { id: 'a', name: 'Линейная алгебра и аналитическая геометрия' },
      { id: 'b', name: 'Дискретная математика' },
    ])).toEqual({ id: 'a', confidence: 'fuzzy' })
  })

  it('returns null for empty or junk input', () => {
    expect(matchDiscipline('', disciplines)).toBeNull()
    expect(matchDiscipline('---', disciplines)).toBeNull()
  })
})

describe('helpers', () => {
  it('classifyPracticeType covers the four types and refuses the rest', () => {
    expect(classifyPracticeType('Учебная (ознакомительная) практика')).toBe('educational_familiarization')
    expect(classifyPracticeType('Учебная (эксплуатационная) практика')).toBe('educational_operational')
    expect(classifyPracticeType('Какая-то иная практика')).toBeNull()
  })

  it('normalizeName strips punctuation and folds ё', () => {
    expect(normalizeName('Тёория_принятия решений!')).toBe('теория принятия решений')
    expect(normalizeName('Тёория')).toBe('теория')
  })

  it('cleanLinkText preserves case, undoes underscores', () => {
    expect(cleanLinkText('Базы_данных  и   СУБД')).toBe('Базы данных и СУБД')
  })
})

/**
 * Best-effort PII stripping for submission text that crosses a teacher boundary
 * (institutional RAG flywheel — phase 3). Applied only on hits pulled from
 * another teacher's pool; a teacher's own retrievals never go through this.
 *
 * The catches:
 *   - Russian-academic name lines: «Студент:», «Имя:», «ФИО:», «Автор:», «Группа:»
 *     anchored at line start with the value on the same line.
 *   - Three-token Russian names ("Фамилия Имя Отчество") in running text.
 *   - Initials patterns ("Иванов И. П." / "И. П. Иванов").
 *
 * This is documented as best-effort in the consent dialog. Anything we miss is
 * the teacher's own approved writing about the student — defensible because
 * it's already shared inside the same institution under the same data
 * controller, but worth naming explicitly to users.
 */
export function sanitiseForCrossTeacherRetrieval(text: string): string {
  let t = text

  // Strip "label: value" lines at the start of a line where the label is one
  // of the common PII headers students put at the top of their work.
  t = t.replace(
    /^\s*(Студент|Имя|ФИО|Автор|Группа|Студентка|Учащийся|Учащаяся)\s*[:：]\s*[^\n]*$/gim,
    '$1: [скрыто]'
  )

  // Russian three-token name in running text. Conservative: requires three
  // tokens all starting with uppercase Russian letters and looking like
  // (Фамилия Имя Отчество). Avoids matching valid two-word terms like
  // "Иван Грозный" by demanding the third token.
  t = t.replace(
    /\b[А-ЯЁ][а-яё]{2,15}\s+[А-ЯЁ][а-яё]{2,15}\s+[А-ЯЁ][а-яё]{2,18}\b/g,
    '[имя]'
  )

  // "Фамилия И. П." / "Фамилия И.П." — initials after a family name
  t = t.replace(
    /\b[А-ЯЁ][а-яё]{2,15}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.\b/g,
    '[имя]'
  )

  // "И. П. Фамилия" / "И.П. Фамилия" — initials before a family name
  t = t.replace(
    /\b[А-ЯЁ]\.\s*[А-ЯЁ]\.\s*[А-ЯЁ][а-яё]{2,15}\b/g,
    '[имя]'
  )

  return t
}

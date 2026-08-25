// Балльно-рейтинговая система — the numeric policy every БРС check measures
// against. Confirmed with the УМЦ as a hard КНИТУ invariant: each semester of
// a discipline budgets exactly 60 minimum and 100 maximum points, whatever
// the mix of оценочные средства.
//
// Lives in config/ rather than beside any one check because three of them now
// depend on it (assessmentLinkage's ФОС↔§9 reconciliation, brsReadiness's
// authoring-time check, and the ФОС generator's per-semester Итого rows) —
// and because it is institution POLICY, not a fact about Russian higher
// education. A second institution with different bounds should read this from
// institution settings rather than silently inherit КНИТУ's.
export const BRS_SEMESTER_MIN = 60
export const BRS_SEMESTER_MAX = 100

// «Экзамен»/«зачёт» are промежуточная аттестация, not текущий контроль. The
// макет handles them apart from the оценочные средства catalogue — they get
// «Примерная форма экзаменационного билета» instead of a «краткая
// характеристика» row — so a check that expects every §9 instrument to have a
// catalogue entry must exempt them, or it fires on essentially every РПД.
// (services/assessmentLinkage.ts exempts them from СРС/КСР for the same
// underlying reason: they are a different kind of thing.)
export const FINAL_ATTESTATION = /экзамен|зач[еёе]т/i

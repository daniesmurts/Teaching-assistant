# КНИТУ — One-Page Feature Map

*GradeAssist → Curriculum Intelligence. How КНИТУ's ideas fit our existing architecture.*
*Legend: 🟢 reuses what we have · 🟡 needs new data model · 🔴 new pillar / privacy scope*

---

### The keystone
Almost every admin ask is an analysis over **one structure: the competency matrix
(матрица компетенций)**. We already own the engine — documents + pgvector embeddings +
DeepSeek. We're adding structured curriculum data and analysis prompts, not new plumbing.

```
учебный план → дисциплины (= our courses) → РПД (= our documents) → компетенции (the matrix)
                                                                         ↑ unlocks the student tier
```

---

### Администрация
| Ask | Fit | Built on |
|---|---|---|
| 🟢 **A3** Дублирование тем между дисциплинами | **shipped** | embeddings + cosine similarity (our RAG engine) |
| 🟢 **A2** Соответствие РПД компетенциям (ОПК/ПК/УК) и целям/результатам | **= наш движок проверки** (компетенции/цели = критерии, РПД = «работа» → покрытие + пробелы + цитаты) | MVP: компетенции вводятся/выбираются вручную (часто уже есть в самом РПД); v2: + competency model |
| 🟡 A1 Цели/задачи ↔ содержание/форматы в РПД | часть той же проверки A2 | + РПД parsing |
| 🟡 A4 Последовательность дисциплин (пререквизиты) | new graph | + curriculum ordering |
| 🟡 A5 Сквозное освоение компетенций (матрица) | **strategic anchor** | + competency matrix |

> **«РПД analysis suite»:** A3 смотрит *между* дисциплинами, A1/A2 — *внутри* одной;
> T5 (ниже) замыкает в петлю «проверка → авторство». A2 — это уже существующий движок
> проверки работ, наведённый на РПД вместо студенческой работы.

### Преподаватель
| Ask | Fit | Built on |
|---|---|---|
| 🟢 T1 Генерация материалов (тесты/кейсы/проекты/задания) | extends existing | presentations + quizzes + topics engine |
| 🟡 **T5** «РПД-студия» — ИИ пишет/обновляет содержание РПД под ОПК/ПК/УК + цели | generation engine + проверка A2 (петля «черновик → проверка → правка») | + competency input; ИИ-черновик, утверждает преподаватель |
| 🟡 T2 Анализ обратной связи → траектория развития | reuses stored grades | analytics layer |
| 🟡 T3 Рекомендации что усилить | builds on T2 | recommendation prompt |
| 🟡 T4 Цифровой портрет (портфолио) | view over T2/T3 | aggregation view |

### Студент
| Ask | Fit | Built on |
|---|---|---|
| 🔴 S1 Динамика компетенций + прогнозы | needs foundation | competency model + student record |
| 🔴 S2 Что/когда исправить, чтобы сдать сессию | builds on S1 | forecasting |
| 🔴 S3 Портрет по работам → треки (научный/произв./лидер./предприн.) | privacy scope | profiling + **152-ФЗ** |
| 🔴 S4 Подбор мероприятий под профиль | needs КНИТУ data | events integration |

---

### Build order
**1.** A3 (done) → **2.** **A2/A1** — grading engine + competency input (next; also the
feature that *justifies building the competency model* → unlocks A5 + student tier) →
**3.** **T5 «РПД-студия»** (pairs with A2) + Teacher T1 → **4.** Admin A4/A5 →
**5.** Student tier (last; privacy scope).

### Ask them tomorrow
Real учебный план + 2–3 РПД samples · competencies structured or in PDFs? ·
student logins vs. admin dashboards about students? · integrate with ЛМС/1С? · who owns/buys this?

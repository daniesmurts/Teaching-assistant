# Статья: «Адаптивная и самооценивающая система ИИ-оценивания…»

Рукопись для подачи в журнал из перечня ВАК (целевой — «Вопросы образования» или
«Информатика и образование») и параллельного препринта на arXiv (cs.CL).

## Файлы

| Файл | Назначение |
|---|---|
| `article.md`        | Полный текст статьи (русский, Markdown) |
| `references.bib`    | Библиография (BibTeX) |
| `results/`          | CSV-выгрузки прогонов eval-харнесса — источник всех чисел в §5 |

## Плейсхолдеры

Каждое число, которое требует **реальных пилотных данных** (а не валидационного
прогона на n=11), помечено маркером `⟦…⟧`. Найти все незаполненные места:

```bash
grep -n "⟦" article.md
```

Когда появятся пилотные данные:
1. `npm run eval -- --teacher <id> --k 0,3,5,10 --csv docs/paper/results/flywheel.csv`
2. `npm run eval:confidence -- --teacher <id> --k 5 --samples 3` (+ сохранить вывод)
3. Подставить числа на место `⟦…⟧`, положить CSV в `results/`.

## Сборка PDF (Pandoc)

```bash
pandoc article.md \
  --bibliography=references.bib \
  --citeproc \
  --pdf-engine=xelatex \
  -V mainfont="PT Serif" \
  -V geometry:margin=2.5cm \
  -o article.pdf
```

Для arXiv-версии (LaTeX-исходник вместо PDF):

```bash
pandoc article.md --bibliography=references.bib --citeproc -s -o article.tex
```

> Требуется `pandoc`, `pandoc-citeproc`/`citeproc` и XeLaTeX (для кириллицы).

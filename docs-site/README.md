# ispum.ru/docs — content source

This directory is the **only** place to add or edit public documentation
articles for university IT teams (ИТ-служба, ИБ/закупки, and eventually
on-prem operators). It is compiled at build time into the site at
`/docs` — see `frontend/scripts/buildDocs.mjs`.

This is a *different* audience and a *different* directory from
`../docs/`, which is internal (dev conventions, deploy runbooks, planning
docs) and never shipped to the public site.

## Adding an article

1. Pick the right section under `articles/<section-slug>/`:
   - `integration/` — SSO, LTI, org structure/roles, teacher provisioning,
     troubleshooting login/access issues. The most-used section.
   - `security/` — 152-ФЗ, data residency, encryption, DPA — written for
     procurement and ИБ, not developers.
   - `on-prem/` — deployment on the university's own infrastructure.
     **Do not write install/operate instructions here until Track 2/3 of
     `../docs/on-prem-deployment.md` has actually shipped and been run for
     real** — an unverified install guide is worse than no guide. Until
     then this section stays a short "available under a separate
     agreement" stub.
2. Create `articles/<section-slug>/<article-slug>.md` with frontmatter:
   ```
   ---
   title: "Человекочитаемый заголовок"
   description: "One sentence — used in the article list and as the meta description for search engines."
   order: 10
   appliesTo: "1.5.0+"
   ---

   Markdown body here.
   ```
   `order` controls position within the section (lower first). `appliesTo`
   is the version stamp shown on the article — set it to the version you
   verified the instructions against; never leave it guessed.
3. Run `npm run build --workspace=frontend` (or just start the dev server)
   to regenerate `frontend/src/generated/docs/` and see it locally at
   `/docs/<section-slug>/<article-slug>`.

## Rule

Same discipline as `FEATURES.md`/`CHANGELOG.md`: **any feature with an
IT-visible integration surface (SSO, LTI, provisioning, org roles, data
handling) ships its docs article in the same commit that ships the
feature**, not as a follow-up.

# Фаза 0 — Фундамент

**Цель:** репозиторий, в котором оба человека могут работать параллельно и независимо: каркас приложения, контракты с фикстурами, CI, превью-деплой.

## BE

- [x] `be/p0-scaffold` — Next.js (App Router, TS strict), Tailwind v4, ESLint, Prettier, Vitest; структура папок по зонам из `CLAUDE.md`; `.env.example`
- [x] `be/p0-vercel` — проект на Vercel, привязка к GitHub (прод — `main`, превью — все ветки), `vercel env pull`
- [x] `be/p0-ci` — GitHub Actions: `typecheck`, `lint`, `test` на каждый PR в `dev` и `main`
- [x] `be/p0-db` — Neon через Vercel Marketplace, Drizzle, первая миграция (`generations`, `artifacts`), Blob-стор
- [x] `be/p0-repo-rules` — защита `main`/`dev` (см. предупреждение про тариф в `architecture/git-workflow.md`)

## Общая зона

- [x] `contracts/v1` — схемы из `architecture/contracts.md` в `src/contracts/`, фикстуры `status-sequence.json`, `status-failed.json`, `artifact-dossier.json`, тест «фикстуры проходят схемы». Пишет BE, FE ревьюит, прежде всего `Artifact.content`: хватает ли полей для задуманного дизайна

## FE

- [x] `fe/p0-design-system` — токены (цвета, типографика с кириллицей, радиусы, тени), темы, базовые компоненты shadcn под бренд
- [x] `fe/p0-mock-client` — `src/lib/client/api.ts` с режимом моков на фикстурах (после merge `contracts/v1`)
- [x] `fe/p0-flow-map` — карта экранов и переходов в Figma: лендинг → ввод → ожидание → артефакт → шаринг; экраны ошибок по `errorCode` (сделано как `architecture/create-flow.md` + вайрфреймы, #8)

## Точки синхронизации

1. `be/p0-scaffold` → merge в `dev` → FE начинает `fe/p0-design-system`. **Единственная блокирующая точка фазы**, делать первой.
2. `contracts/v1` → merge → FE начинает `fe/p0-mock-client`.

## Definition of Done

- [x] `dev` и `main` задеплоены на Vercel, у PR есть превью-ссылки
- [x] CI обязателен и зелёный
- [x] `src/contracts` + фикстуры в `dev`, тест проходит
- [x] FE открывает локально страницу с моками без единого запроса к BE
- [ ] Тег `v0.0.1` — последний шаг фазы, ставится после мержа сверки планов (`docs/plan-sync`)

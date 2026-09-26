# Архитектура — карта

- [stack.md](stack.md) — технологический стек и почему именно он
- [pipeline.md](pipeline.md) — конвейер генерации: от ссылки до готового артефакта
- [contracts.md](contracts.md) — контракты SERJ↔DAN: схемы, эндпоинты, статусы, моки
- [data.md](data.md) — БД, хранилище файлов, сроки хранения
- [git-workflow.md](git-workflow.md) — ветки, PR, защита от потери прогресса

## Схема одним взглядом

```
Пользователь ──▶ Next.js (SERJ: лендинг, ввод, прогресс, страница артефакта)
                     │  POST /api/generations        GET /api/generations/:id (поллинг)
                     ▼
               API (DAN, route handlers) ──▶ Vercel Workflow (надёжный конвейер)
                                                 1. scrape    → Apify → ProfileSnapshot
                                                 2. analyze   → LLM   → PersonaProfile  ← источник истины
                                                 3. write     → LLM   → ArtifactContent + image prompts
                                                 4. draw      → KIE API (GPT Image 2.5) × N → Vercel Blob
                                                 5. assemble  → Artifact (slug) → status: ready
                     ▼
               Postgres (Neon) + Blob          /a/[slug] — публичная страница + OG-картинка для мессенджеров
```

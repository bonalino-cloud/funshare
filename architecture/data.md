# Данные (зона BE)

## Таблицы (Drizzle, Postgres)

| Таблица | Ключевые поля | Заметки |
|---|---|---|
| `generations` | `id`, `status`, `errorCode`, `igUsername`, `mode`, `kind`, `ownerTokenHash`, `ipHash`, `stepTimings jsonb`, `costCents`, `artifactId`, `createdAt`, `updatedAt` | Журнал каждого запуска, в том числе упавших |
| `profile_snapshots` | `id`, `igUsername`, `data jsonb` (`ProfileSnapshot`), `rawBlobKey`, `fetchedAt` | Кэш 24 ч; удаляем через 30 дней |
| `personas` | `id`, `snapshotId`, `data jsonb` (`PersonaProfile`), `model`, `promptVersion` | Источник истины для любых артефактов |
| `artifacts` | `id`, `slug`, `generationId`, `kind`, `content jsonb`, `images jsonb`, `ownerTokenHash`, `views`, `shares`, `createdAt`, `deletedAt` | `slug` — 10 символов nanoid |
| `events` | `id`, `artifactId`, `type` (`view` \| `share_click` \| `copy_link` \| `story_share` \| `cta_click`), `createdAt` | Продуктовая аналитика |
| `joke_cards` | `id`, `source` (unique, `s1#5`), `section`, `text`, `textHash`, `mechanism`, `skeleton`, `slots`, `heat`, `topic`, `redline`, `wellDoneOnly`, `nsfw`, `transferable`, `approved` (default false), `score` (default 0), `labelVersion`, `labelModel`, `createdAt`, `updatedAt` | Банк шуток 18+, читает только сервер (§5.1 roast-engine). Заполняет `pnpm jokes:ingest`, upsert по `source`. `textHash` = нормализованный текст + 🔞: изменился — разметка перезаписана, `approved` сброшен. `usableAsExample` не хранится (функция от уровня). Флаги `redline`/`wellDoneOnly` выводит код по теме, плюс CHECK в БД |

## Blob

- `raw/<igUsername>/<fetchedAt>.json` — private, сырой ответ Apify.
- `art/<slug>/<n>.webp` — public, иллюстрации.

## Хранение и удаление

- Сырые снимки и `profile_snapshots` старше 30 дней удаляет ежедневный Cron.
- `DELETE /api/artifacts/:slug` ставит `deletedAt`, удаляет картинки из Blob. Страница отдаёт 410.
- IP и `ownerToken` храним только в виде хэша.

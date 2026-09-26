# Данные (зона DAN)

## Таблицы (Drizzle, Postgres)

| Таблица | Ключевые поля | Заметки |
|---|---|---|
| `generations` | `id`, `status`, `errorCode`, `igUsername`, `mode`, `kind`, `ownerTokenHash`, `ipHash`, `stepTimings jsonb`, `costCents`, `artifactId`, `createdAt`, `updatedAt` | Журнал каждого запуска, в том числе упавших |
| `profile_snapshots` | `id`, `igUsername`, `data jsonb` (`ProfileSnapshot`), `rawBlobKey`, `fetchedAt` | Кэш 24 ч; удаляем через 30 дней |
| `personas` | `id`, `snapshotId`, `data jsonb` (`PersonaProfile`), `model`, `promptVersion` | Источник истины для любых артефактов |
| `artifacts` | `id`, `slug`, `generationId`, `kind`, `content jsonb`, `images jsonb`, `ownerTokenHash`, `views`, `shares`, `createdAt`, `deletedAt` | `slug` — 10 символов nanoid |
| `events` | `id`, `artifactId`, `type` (`view` \| `share_click` \| `copy_link` \| `story_share` \| `cta_click`), `createdAt` | Продуктовая аналитика |

## Blob

- `raw/<igUsername>/<fetchedAt>.json` — private, сырой ответ Apify.
- `art/<slug>/<n>.webp` — public, иллюстрации.

## Хранение и удаление

- Сырые снимки и `profile_snapshots` старше 30 дней удаляет ежедневный Cron.
- `DELETE /api/artifacts/:slug` ставит `deletedAt`, удаляет картинки из Blob. Страница отдаёт 410.
- IP и `ownerToken` храним только в виде хэша.

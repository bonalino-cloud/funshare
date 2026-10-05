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

- `raw/<igUsername>/<fetchedAt>.json` — private, сырой ответ Apify. Отдельный private store, токен `BLOB_RAW_READ_WRITE_TOKEN`.
- `art/<slug>/<n>.webp` — public, иллюстрации. Public store, токен `BLOB_READ_WRITE_TOKEN`.
- `avatars/<HMAC(ник)[:32]>` — public, копия аватара Instagram (CDN Instagram отдаёт `Cross-Origin-Resource-Policy: same-origin`, браузер исходный URL не покажет). Public store, токен `BLOB_READ_WRITE_TOKEN`. Ключ детерминированный, без ника и расширения (тип — `contentType` по байтам): повтор проверки того же ника перезаписывает файл. Копируется шагом проверки профиля (`src/server/profile-check/avatar.ts`) только после успешного `analyze`, поэтому фото закрытых профилей и младше 16 в Blob не попадает. Любой сбой → `avatarUrl: null`, проверка не падает.
  - В `CheckedProfile.avatarUrl` (`profile_checks.profile`) и в `subject.avatarUrl` артефакта лежит НАШ Blob URL. `ProfileSnapshot.avatarUrl` остаётся URL Instagram: он нужен только серверу. Сборка артефакта берёт `subject.avatarUrl` из проверки профиля, не из снимка.

## Хранение и удаление

- Сырые снимки и `profile_snapshots` старше 30 дней удаляет ежедневный Cron. `list`/`del` по `raw/` — с токеном `BLOB_RAW_READ_WRITE_TOKEN` (`rawBlobToken()` из `src/server/scrape/blob.ts`): с токеном по умолчанию SDK смотрит в public store и сырьё не найдёт.
- Аватары `avatars/` храним столько же, как сырьё: 30 дней. TODO (Cron очистки): удалять `avatars/` старше 30 дней — `list`/`del` с публичным `BLOB_READ_WRITE_TOKEN`. Пока Cron нет, файлы копятся (один файл на ник, до 1 МБ).
- `DELETE /api/artifacts/:slug` ставит `deletedAt`, удаляет картинки из Blob. Страница отдаёт 410.
- IP и `ownerToken` храним только в виде хэша.

# Данные (зона BE)

## Таблицы (Drizzle, Postgres)

| Таблица | Ключевые поля | Заметки |
|---|---|---|
| `generations` | `id`, `status`, `errorCode`, `igUsername`, `mode`, `kind`, `ownerTokenHash`, `ipHash`, `stepTimings jsonb`, `costCents`, `costMicroUsd`, `costDetail jsonb`, `artifactId`, `createdAt`, `updatedAt` | Журнал каждого запуска, в том числе упавших |
| `profile_snapshots` | `id`, `igUsername`, `data jsonb` (`ProfileSnapshot`), `rawBlobKey`, `fetchedAt` | Кэш 24 ч; удаляем через 30 дней |
| `personas` | `id`, `snapshotId`, `data jsonb` (`PersonaProfile`), `model`, `promptVersion` | Источник истины для любых артефактов |
| `artifacts` | `id`, `slug`, `generationId`, `kind`, `content jsonb`, `images jsonb`, `subject jsonb`, `ownerTokenHash`, `views`, `shares`, `createdAt`, `deletedAt` | `slug` — 10 символов nanoid. `subject` (`username`, `displayName`, `avatarUrl`) пишется при публикации и не зависит от срока жизни `profile_checks`; `null` у строк до миграции `0009`, их читаем через `generations` + `profile_checks` |
| `events` | `id`, `artifactId`, `type` (`view` \| `share_click` \| `copy_link` \| `story_share` \| `cta_click`), `createdAt` | Продуктовая аналитика |
| `joke_cards` | `id`, `source` (unique, `s1#5`), `section`, `text`, `textHash`, `mechanism`, `skeleton`, `slots`, `heat`, `topic`, `redline`, `wellDoneOnly`, `nsfw`, `transferable`, `approved` (default false), `score` (default 0), `labelVersion`, `labelModel`, `createdAt`, `updatedAt` | Банк шуток 18+, читает только сервер (§5.1 roast-engine). Заполняет `pnpm jokes:ingest`, upsert по `source`. `textHash` = нормализованный текст + 🔞: изменился — разметка перезаписана, `approved` сброшен. `usableAsExample` не хранится (функция от уровня). Флаги `redline`/`wellDoneOnly` выводит код по теме, плюс CHECK в БД |
| `generation_traces` | `id`, `generationId` (FK, cascade), `step`, `data jsonb`, `createdAt`; unique (`generationId`, `step`) | Private: приватные трассы шагов для админки (§9.5 roast-engine), наружу не отдаются ни одним роутом и не джойнятся в публичные ответы. Пока пишет только шаг `write` (`step = 'write'`, форма `WriteTrace` в `src/server/roast/write/trace.ts`): крючки по раундам (id наблюдений), все кандидаты писателя с исходом (`chosen`, `reserve`, `dropped_layer4`, `dropped_judge`, `unscored`, `dropped_layer5`, `unmoderated`), кодом причины, оценками судьи и вердиктом модератора, `jokeCardId`, `FilterReport`, версии промптов и моделей. Тексты шуток хранятся (это и нужно разбору); текст с canary или цепочкой слов промпта не хранится ни у одного кандидата (в том числе у брака писателя, не дошедшего до слоя 4). Записей кандидатов не больше 400 (лишние отрезаются, их число в `omittedCandidates`), это до ~250 КБ jsonb на генерацию. Провалившийся шаг тоже оставляет трассу (`result = 'failed'`, код причины). Повтор шага перезаписывает строку. Запись трассы идёт после записи кандидатов, её сбой не роняет генерацию (в лог только имя ошибки) |

## Стоимость (учёт трат, задача `be/p1-cost-log`)

Код: `src/server/cost/`. Цены лежат в ОДНОМ файле `src/server/cost/prices.ts` (USD за 1M токенов по моделям, тариф Apify за результат, дата сверки `PRICES_CHECKED_AT`). Остальной код считает токены и штуки.

**Что считаем.** Каждый вызов LLM (роли `analyze`, `writer`, `judge`, `moderator`) пишет в счётчик `CostMeter` токены из `usage` ответа: вход без кэша, выход, чтение и запись кэша. Считаются ВСЕ вызовы, включая неудачные и ретраи шага (мы за них платим): у «ответа не по схеме» токены берутся из ошибки AI SDK, у сетевого сбоя их нет (учитывается только попытка). Apify: эндпоинт `run-sync-get-dataset-items` отдаёт только датасет, `usageTotalUsd` в ответе нет, поэтому стоимость скрейпа — ОЦЕНКА: число полученных результатов × тариф за результат (`source: "estimate"`). Кэш снимка и кэш досье ничего не стоят и ничего не пишут.

**Где лежит.**

| Таблица | Колонки | Что |
|---|---|---|
| `profile_checks` | `costCents int`, `costMicroUsd int`, `costDetail jsonb` (один `CostRun`) | Траты проверки профиля: Apify + анализ. Пишутся при закрытии проверки (`ok` и `failed`). Копия из кэша и строка в `checking`: 0 / `null` |
| `generations` | `costCents int` (уже была), `costMicroUsd int`, `costDetail jsonb` = `{ "<шаг>": CostRun[] }` | Траты шагов ГЕНЕРАЦИИ (`write` сейчас; `draw` и `assemble` подключатся к тому же `addStepCost`). Стоимость проверки профиля сюда НЕ входит |

`CostRun` (zod, `src/server/cost/meter.ts`): `llm[]` (роль, модель, `calls`, `failedCalls`, токены, `microUsd`), `apify` (`attempts`, `results`, `microUsd`, `source`) или `null`, `microUsd` (итог), `estimated` (есть неподтверждённая цена), `pricesAsOf`. Тексты, ники и ответы провайдеров в `costDetail` не попадают, только числа и имена ролей и моделей.

**Почему разбивка в `generations.costDetail`, а не в `stepTimings` или трассе.** `stepTimings` описывает время и читается и пишется общим SQL переходов статусов (`timingsSql`): деньги в нём смешали бы два назначения. `generation_traces` приватная, живёт 30 дней и перезаписывается при повторе шага, а стоимость повтора шага нужна как раз накопительной. Отдельная колонка в `generations` даёт дашборду (§9.6 roast-engine) сумму и разбивку одним запросом без джойна, с тем же сроком жизни, что у генерации.

**Не считать дважды.** Проверка профиля кэшируется на 24 ч и может обслужить несколько генераций (`generations.profileCheckId`). Её траты лежат только в `profile_checks` и в `generations.costCents` НЕ добавляются. Полная цена одной генерации = `generations.costCents` + доля проверки; доля считается по запросу через `profileCheckId` (`profile_checks.costCents`), а как делить проверку между генерациями (поровну, на первую или не делить), решает дашборд, не схема. Суммарные траты проекта = `sum(profile_checks.cost_micro_usd) + sum(generations.cost_micro_usd)` без пересечений.

**Точность.** Деньги внутри в целых микродолларах (1e-6 USD, `Math.round` один раз на строку «роль+модель», токены суммируются точно). Центы целые и округляются ВВЕРХ ОДИН РАЗ от итога: `costCents = ceil(costMicroUsd / 10000)`. Для генерации это делает сам UPDATE (`cost_micro_usd = cost_micro_usd + $1`, `cost_cents = ceil(новая сумма / 10000)`): параллельные шаги и ретраи не теряют друг друга, а ошибка округления не копится по вызовам (десять вызовов по 0.07 цента дают 1 цент, а не 10). Недооценка у `costCents` невозможна, переоценка меньше одного цента на запись. Поле `costMicroUsd` для точной суммы по многим записям.

**Идемпотентность.** Шаг `write` пишет траты сразу после `writeCandidates` (и при провале тоже, деньги потрачены), ДО записи кандидатов. Повтор шага, когда кандидаты уже есть, модель не зовёт и траты не пишет. Повтор после сбоя записи кандидатов зовёт модель снова и ДОПИСЫВАЕТ второй прогон в `costDetail.write`: ретрай стоит реальных денег. Сбой записи трат не роняет генерацию (в лог только имя ошибки).

**Пределы учёта.** (1) Внутренний повтор AI SDK (`maxRetries: 1` на сеть и 5xx) не виден: учитывается только итоговый ответ; у провалившегося сетевого запроса токенов обычно нет. (2) Проверка профиля, закрытая дедлайном или GET по `STALE_AFTER_MS`, пишет только то, что успело накопиться; работа, дошедшая до конца после закрытия, в БД не попадает: её полный итог пишется в лог отдельной строкой `[cost] profile-check после дедлайна`. (3) Цены см. `prices.ts`, сверены 2026-10-06 (`pricesAsOf`): `claude-sonnet-5` по прайсу Anthropic, Apify по тарифу актора для плана FREE. `estimated` у прогона ставится только при неподтверждённой цене или неизвестной модели. Сумма Apify при этом остаётся оценкой (результаты × тариф, фактического списания в ответе нет): это видно по `apify.source: "estimate"`, а не по `estimated`. Строки, записанные до сверки, хранят `pricesAsOf` старой таблицы и `estimated: true`.

## Blob

- `raw/<igUsername>/<fetchedAt>.json` — private, сырой ответ Apify. Отдельный private store, токен `BLOB_RAW_READ_WRITE_TOKEN`.
- `art/<slug>/<n>.webp` — public, иллюстрации. Public store, токен `BLOB_READ_WRITE_TOKEN`.
- `avatars/<HMAC(ник)[:32]>` — public, копия аватара Instagram (CDN Instagram отдаёт `Cross-Origin-Resource-Policy: same-origin`, браузер исходный URL не покажет). Public store, токен `BLOB_READ_WRITE_TOKEN`. Ключ детерминированный, без ника и расширения (тип — `contentType` по байтам): повтор проверки того же ника перезаписывает файл. Копируется шагом проверки профиля (`src/server/profile-check/avatar.ts`) только после успешного `analyze`, поэтому фото закрытых профилей и младше 16 в Blob не попадает. Любой сбой → `avatarUrl: null`, проверка не падает.
  - В `CheckedProfile.avatarUrl` (`profile_checks.profile`) и в `subject.avatarUrl` артефакта лежит НАШ Blob URL. `ProfileSnapshot.avatarUrl` остаётся URL Instagram: он нужен только серверу. Сборка артефакта берёт `subject.avatarUrl` из проверки профиля, не из снимка.

## Хранение и удаление

- Сырые снимки и `profile_snapshots` старше 30 дней удаляет ежедневный Cron. `list`/`del` по `raw/` — с токеном `BLOB_RAW_READ_WRITE_TOKEN` (`rawBlobToken()` из `src/server/scrape/blob.ts`): с токеном по умолчанию SDK смотрит в public store и сырьё не найдёт.
- `generation_traces` старше 30 дней удаляет тот же ежедневный Cron (`DELETE ... WHERE created_at < now() - interval '30 days'`, индекс `generation_traces_created_idx`). TODO (Cron очистки): пока Cron нет, строки копятся. В трассах лежат тексты шуток и id наблюдений профиля, так что срок 30 дней держится только после появления Cron: учесть в его задаче вместе с `profile_snapshots` и `avatars/`.
- Аватары `avatars/` храним столько же, как сырьё: 30 дней. TODO (Cron очистки): удалять `avatars/` старше 30 дней — `list`/`del` с публичным `BLOB_READ_WRITE_TOKEN`. Пока Cron нет, файлы копятся (один файл на ник, до 1 МБ). Учесть в задачах Cron и `DELETE /api/artifacts/:slug`: `subject.avatarUrl` артефакта указывает на этот же файл, он один на ник и общий для всех артефактов этого ника. После удаления файла артефакт должен показывать букву ника (как `Avatar` на FE), а не битую картинку.
- `GET /api/artifacts/:slug` (`src/server/artifacts/`): публично, slug проверяется форматом (10 символов a–z, A–Z, 0–9) до БД, невалидный и несуществующий — 404, `deletedAt` — 410. `subject` берётся из `artifacts.subject` (у старых строк — из `generations` + `profile_checks`), `isOwner` — по cookie. `Cache-Control: private, no-cache` + `Vary: Cookie` (удаление видно сразу), ошибки `no-store`. Счётчик `views` пока не ведётся: правила подсчёта не решены.
- `DELETE /api/artifacts/:slug` ставит `deletedAt`, удаляет картинки из Blob. Страница отдаёт 410.
- IP и `ownerToken` храним только в виде хэша.

# Фаза 1 — Текстовый MVP

**Цель:** пользователь вставляет ссылку на реальный профиль и через ≤ 60 с видит текстовое досье на странице `/a/[slug]`. Картинок пока нет, на их месте плейсхолдеры.

## BE

Единый список: базовая труба этой фазы + задачи прожарки из [roast-engine.md §12](../architecture/roast-engine.md). Порядок — по зависимостям: генерация по контракту требует готовой проверки профиля (`profileCheckId`) и заказа. Отмечать `[x]` здесь; §12 ссылается сюда.

- [x] `contracts/roast-v1`, `contracts/pricing-v1` — влиты как #9 и #35 (тарифы от 2026-10-02)
- [x] `contracts/persona-roast` — досье прожарки в `PersonaProfile`: `observations`, `warmFacts`, `signatureMoves`, `sensitiveEvents` (все необязательные)
  - Итог (2026-10-03): в #35 вошло только `look`, поля §4 добавлены этой веткой · `Observation` с обязательным `evidence` (`post:N` / `fact:вид:значение`), лимиты длины, уникальные `id` · фикстура `persona-roast.json`, 226 тестов · карусель 9/9 (закрыла свободный текст в `evidence`, строки из пробелов) · `sensitiveEvents` не дописываются в `avoidTopics`: запретный список = объединение
- [ ] 1. `be/p1-scrape-step` — Apify → `ProfileSnapshot`, сырой ответ в private Blob, кэш 24 ч, ошибки `profile_not_found` / `profile_private`. Пишется и тестируется на фикстурах, живой прогон — с `APIFY_TOKEN`
  - Итог (2026-10-03): код в `dev` (#45) — `src/server/scrape/`: ник → кэш 24 ч → Apify REST 40 с + 1 ретрай → private Blob → `profile_snapshots`, миграция `drizzle/0001` · 135 тестов на фикстурах · `[x]` после живого прогона с `APIFY_TOKEN` и `db:migrate`; проверить, 12 или 24 поста отдаёт актор
- [x] 2. `be/p1-facts` — `ProfileFacts`: статистика, повторы, чистка PII, кэп подписей
  - Итог (2026-10-03): `src/server/facts/` — `buildProfileFacts(snapshot)` без LLM: статистика (UTC), повторы, ритм, язык ru/en, чистка PII, `captionsForLlm` с кэпом 300 и без `<>` · 81 новый тест (161 всего) · карусель 9/9 (поймала два телефона подряд, тире «–», `youtu.be`, медленную очистку на мусоре) · открыто: закреплённые посты искажают паузу (нужен `isPinned` в контракте), `@упоминания` идут в LLM
- [ ] 3. `be/p1-analyze-step` — досье с `observations` / `warmFacts` / `sensitiveEvents`, гардрейлы `likelyMinor` / `insufficientData`, промпт `v1`
  - Итог (2026-10-03): `src/server/analyze/` — `analyzePersona` / `analyzeStep`: AI SDK 7 (`generateText` + `Output.object`), `claude-sonnet-5`, промпт `prompts/analyze/v1.ts`, до 6 обложек по URL · код сверяет `post:N` и цифры `fact:*` с ProfileFacts, вычёркивает наблюдения без опоры, ставит `id`, чистит PII в ответе · 3 попытки → `internal`, гардрейлы до записи · таблица `personas` (уникально по снимку и версии промпта, каскад от снимка), миграция `drizzle/0002` не применена · 266 тестов · `[x]` после живого прогона с `ANTHROPIC_API_KEY` и `db:migrate`
- [ ] 4. `be/p1-profile-check` — `POST /api/profile-checks`, `GET …/:id`: `scrape → facts → analyze` до оплаты, гардрейлы (закрыт, мало данных, младше 16), кэш 24 ч, лимиты на проверки
- [ ] 5. `be/p1-orders-promos` — `orders`, `promo_codes`, `promo_redemptions`, расчёт цены по `TIERS`, атомарное списание кода, освобождение при провале, лимит на перебор
- [ ] 6. `be/p1-generations-api` — `POST /api/generations` (`profileCheckId`, `tier`, `level`, `ageConfirmed`, `promoCode`, `trialGenerationId`, cookie `ownerToken`), `GET /api/generations/:id`
- [ ] 7. `be/p1-workflow-skeleton` — Vercel Workflow с шагами-заглушками, смена статусов в БД, `stepTimings`
- [ ] 8. `be/p1-joke-bank` — таблица `joke_cards`, `jokes:ingest`, разметка, ревью-таблица; корпус вынести из публичного репо до запуска (§13 п.2)
- [ ] 9. `be/p1-write-step` — досье + факты пользователя → крючки → банк → писатель ×3 → судья, до N кандидатов (до 10 / до 20 по тарифу), в Кострище + перенос выбранных из Поджога
- [ ] 10. `be/p1-selection` — `GET …/candidates`, `POST …/selection`, проверка id и числа (от 1 до `selectCount`), авторитетная сборка артефакта из выбранных
- [ ] 11. `be/p1-artifact-read` — `GET /api/artifacts/:slug`, серверная функция `getArtifact(slug)` для страницы
- [ ] 12. `be/p1-output-filters` — слои 4 и 5, тесты фильтров
- [ ] 13. `be/p1-traces` — `generation_traces`, canary, CI-проверка бандла
- [ ] 14. `be/p1-cost-log` — учёт токенов и стоимости Apify на генерацию
- [ ] 15. `be/p1-eval-set` — 10 реальных публичных профилей × 3 уровня, скрипт прогона и сравнения версий промптов

Админка и аналитика — отдельным блоком в [roast-engine.md §12](../architecture/roast-engine.md), после пунктов 1–11.

## FE

- [ ] `fe/p1-landing` — лендинг: суть в одном экране, поле ссылки, переключатель «Для себя / Для друга», примеры артефактов
- [ ] `fe/p1-input-validation` — проверка ссылки на клиенте, понятные подсказки (`instagram.com/username`, `@username`)
- [ ] `fe/p1-progress-screen` — экран ожидания по статусам: человеческие фразы, анимация, ощущение движения на 60 с
- [ ] `fe/p1-error-states` — экран на каждый `errorCode` с действием («Попробовать другой профиль»)
- [ ] `fe/p1-artifact-page` — `/a/[slug]`: вёрстка досье по `Artifact.content`, плейсхолдеры под картинки, мобильная версия в приоритете
- [ ] `fe/p1-switch-to-real-api` — выключение моков на превью `dev`, проверка всего флоу вживую

## Точки синхронизации

1. `be/p1-profile-check` в `dev` → FE подключает шаг проверки профиля к реальному API.
2. `be/p1-generations-api` + `be/p1-workflow-skeleton` в `dev` → FE проверяет прогресс-экран на реальных статусах (шаги пока заглушки).
3. `be/p1-write-step` + `be/p1-selection` + `be/p1-artifact-read` в `dev` → `fe/p1-switch-to-real-api`.
4. Если FE нужно новое поле в артефакте — сначала `contracts/<что>`, потом код.

## Definition of Done

- [ ] 8 из 10 профилей eval-сета дают `ready`, 2 закрытых/пустых — корректные ошибки
- [ ] p90 времени до `ready` ≤ 60 с
- [ ] Страница артефакта открывается по прямой ссылке в мобильном браузере
- [ ] Известна себестоимость одной текстовой генерации
- [ ] Тег `v0.1.0`

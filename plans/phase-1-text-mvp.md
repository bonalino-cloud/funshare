# Фаза 1 — Текстовый MVP

**Цель:** пользователь вставляет ссылку на реальный профиль и через ≤ 60 с видит текстовое досье на странице `/a/[slug]`. Картинок пока нет, на их месте плейсхолдеры.

## BE

Единый список: базовая труба этой фазы + задачи прожарки из [roast-engine.md §12](../architecture/roast-engine.md). Порядок — по зависимостям: генерация по контракту требует готовой проверки профиля (`profileCheckId`) и заказа. Отмечать `[x]` здесь; §12 ссылается сюда.

- [x] `contracts/roast-v1`, `contracts/persona-roast`, `contracts/pricing-v1` — влиты как #9 и #35 (тарифы от 2026-10-02)
- [ ] 1. `be/p1-scrape-step` — Apify → `ProfileSnapshot`, сырой ответ в private Blob, кэш 24 ч, ошибки `profile_not_found` / `profile_private`. Пишется и тестируется на фикстурах, живой прогон — с `APIFY_TOKEN`
- [ ] 2. `be/p1-facts` — `ProfileFacts`: статистика, повторы, чистка PII, кэп подписей
- [ ] 3. `be/p1-analyze-step` — досье с `observations` / `warmFacts` / `sensitiveEvents`, гардрейлы `likelyMinor` / `insufficientData`, промпт `v1`
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

Сверено с кодом `dev` 2026-10-03. Вместо «досье» FE собрал флоу прожарки по [create-flow.md](../architecture/create-flow.md): 7 шагов на моках (`NEXT_PUBLIC_USE_MOCKS=1`), все `fe/p1-*` ветки влиты.

- [x] `fe/p1-landing` — лендинг прожарки на `/` (`/roast` → редирект), секции, CTA, история
- [x] `fe/p1-input-validation` — `instagram.com/name`, `@name`, `name`, тесты в `instagram.test.ts`
- [x] `fe/p1-create-*` — шаги профиль → факты → тариф → прожарка → итог (`fe/p1-create-shell`, `-profile`, `-facts`, `-tier`, `-level`, `fe/p1-checkout`; тарифы от 2026-10-02 — #36)
- [x] `fe/p1-progress-screen` — лоудер с огнём и сменой статусов человеческими словами (`fe/p1-generation-loader`)
- [x] `fe/p1-error-states` — тексты по каждому `errorCode` на шаге профиля и в генерации (`create/errors.ts`)
- [x] `fe/p1-pick-punches` — выбор шуток 1..`selectCount` из кандидатов
- [x] `fe/p1-artifact-page` — `/a/[slug]`: карточки 9:16 вместо досье (см. фазу 2), «Прожарь в ответ»
- [ ] 1. `fe/p1-real-profile-check` — шаг профиля на живом `POST/GET /api/profile-checks`, мини-лоудер на реальных 10–30 с. **Ждёт `be/p1-profile-check`**
- [ ] 2. `fe/p1-real-generation` — старт, поллинг статусов, кандидаты и выбор на живом API, cookie `ownerToken`. **Ждёт `be/p1-generations-api` + `be/p1-workflow-skeleton`, затем `be/p1-write-step` + `be/p1-selection`**
- [ ] 3. `fe/p1-switch-to-real-api` — `/a/[slug]` читает `getArtifact(slug)` на сервере, моки выключены на превью `dev`, весь флоу вживую на телефоне. **Ждёт `be/p1-artifact-read`**
- [ ] 4. `fe/p1-admin-promos` — экраны промокодов. **Ждёт `be/p1-admin-api`** ([roast-engine.md §12](../architecture/roast-engine.md))
- [ ] 5. `fe/p1-admin-generations` — список и карточка генераций. **Ждёт `contracts/admin-v1`**

## Точки синхронизации

1. `be/p1-profile-check` в `dev` → `fe/p1-real-profile-check`.
2. `be/p1-generations-api` + `be/p1-workflow-skeleton` в `dev` → `fe/p1-real-generation`: лоудер на реальных статусах (шаги пока заглушки).
3. `be/p1-write-step` + `be/p1-selection` + `be/p1-artifact-read` в `dev` → `fe/p1-switch-to-real-api`.
4. Если FE нужно новое поле в артефакте — сначала `contracts/<что>`, потом код.

## Definition of Done

- [ ] 8 из 10 профилей eval-сета дают `ready`, 2 закрытых/пустых — корректные ошибки
- [ ] p90 времени до `ready` ≤ 60 с
- [ ] Страница артефакта открывается по прямой ссылке в мобильном браузере
- [ ] Известна себестоимость одной текстовой генерации
- [ ] Тег `v0.1.0`

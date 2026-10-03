# Контракты FE↔BE (общая зона)

Контракт — единственное место, где зоны касаются друг друга. Код лежит в `src/contracts/`. Любое изменение — отдельная ветка `contracts/<что>` и ревью обоих.

## Файлы

```
src/contracts/
  generation.ts      GenerationRequest (tier, level, extraFacts, promoCode), GenerationStatus,
                     ErrorCode, Tier, Level, PunchCandidate, CandidatesResponse, SelectionRequest
  profile-check.ts   ProfileCheckRequest/Created/Status — проверка профиля до оплаты
  pricing.ts         Pricing, TierInfo, QuoteRequest, Quote — цены в копейках, «волшебное слово»
  profile.ts         ProfileSnapshot (нормализованный скрейп)      — только BE
  persona.ts         PersonaProfile (источник истины)             — только BE
  artifact.ts        ArtifactContent, RoastContent, Artifact (union по kind) — BE пишет, FE рисует
  index.ts           реэкспорт + CONTRACT_VERSION
  fixtures/          готовые JSON-примеры для моков FE и тестов BE
    profile-check-ok.json      checking → ok с профилем
    profile-check-failed.json  по одному failed на каждый errorCode проверки
    pricing.json               три тарифа
    quotes.json                без слова / бесплатная проба / −50 % / −100 %
    generation-request.json    запрос на Кострище, medium, 3 факта, слово
    status-sequence.json       queued → writing → awaiting_selection → drawing → ready
    status-failed.json
    candidates-20.json         20 шуток Кострища, выбрать 6
    selection.json             выбор пользователя (порядок = порядок в артефакте)
    artifact-roast.json        готовая прожарка из выбранных шуток
    artifact-dossier.json      артефакт первого типа (dossier_2027)
```

## Эндпоинты

| Метод | Путь | Тело / ответ |
|---|---|---|
| `POST` | `/api/profile-checks` | → `ProfileCheckRequest { instagramUrl }`; ← `{ id }`. Проверка до оплаты: открыт, хватает данных, есть 16. Ставит cookie `ownerToken` |
| `GET` | `/api/profile-checks/:id` | ← `ProfileCheckStatus`: `checking` (с `hint`) \| `ok` + `profile` \| `failed` + `errorCode` |
| `GET` | `/api/pricing` | ← `Pricing`: три `TierInfo` (копейки, состав) + `freeTrialAvailable` |
| `POST` | `/api/quotes` | → `QuoteRequest { tier, promoCode? }`; ← `Quote` или ошибка `promo_invalid`. Ничего не тратит |
| `POST` | `/api/generations` | → `GenerationRequest { profileCheckId, mode, kind, tier, level, ageConfirmed?, extraFacts?, promoCode? }`; ← `{ id }`. Итог > 0 без билинга → `payment_required` |
| `GET` | `/api/generations/:id` | ← `GenerationStatus`: `{ id, status, errorCode?, artifactSlug?, hint?, updatedAt }` |
| `GET` | `/api/generations/:id/candidates` | ← `CandidatesResponse { generationId, selectCount, candidates[] }`, только при `awaiting_selection` и только владельцу |
| `POST` | `/api/generations/:id/selection` | → `SelectionRequest { punchIds }` ровно `selectCount` штук; ← `202`. Порядок = порядок в артефакте |
| `GET` | `/api/artifacts/:slug` | ← `Artifact` (публичные данные, без сырых данных профиля) |
| `DELETE` | `/api/artifacts/:slug` | только с `ownerToken` владельца; ← `204` |

Страница `/a/[slug]` читает артефакт на сервере напрямую (server component), без HTTP-запроса к себе.

## Статусы

Проверка профиля: `checking → ok | failed`.

Генерация: `queued → writing → awaiting_selection → drawing → ready`, из любого — `failed`. Скрейп и анализ идут в проверке профиля, до оплаты, поэтому в генерации их статусов нет. У Поджога `drawing` пропускается.

## `Artifact`: union по `kind`

`kind: "roast_v1"` → `content: RoastContent { title, tagline, punches[{ id, emoji, text }], finale, shareText }`. Шутки в артефакте — ровно те, что выбрал человек, в его порядке; `id` совпадает с id кандидата.

`kind: "dossier_2027"` → `content: ArtifactContent` (ниже, первый тип артефакта):

```ts
Artifact = {
  slug: string
  kind: "dossier_2027"        // см. union выше
  createdAt: string            // ISO
  subject: { username: string; displayName: string; avatarUrl: string | null }
  mode: "self" | "friend"
  content: {
    title: string              // «Досье на @username»
    tagline: string            // одна строка-хук
    traits: { label: string; value: string; emoji: string }[]   // 4–6
    superpower: string
    weakness: string
    predictions: { area: "love" | "money" | "travel" | "career" | "health" | "wildcard"; text: string }[]
    closing: string
  }
  images: { role: "hero" | "section"; url: string; alt: string }[]
  isOwner: boolean             // вычисляется по cookie, у чужих — false
}
```

## История версий

- **v2** (`contracts/create-flow-v1`): проверка профиля вынесена в `/api/profile-checks`; в `GenerationRequest` вместо `instagramUrl` — `profileCheckId`, добавлены `tier`, `level`, `ageConfirmed`, `extraFacts`, `promoCode`; статусы `scraping`/`analyzing` убраны из генерации, добавлен `awaiting_selection`; новые `ErrorCode`: `free_used`, `promo_invalid`, `payment_required`; цены и слово; кандидаты и выбор; `Artifact` стал union, добавлен `roast_v1`. **BE:** пересоздать pg-enum `generation_status` и `error_code` миграцией (данных в БД нет), `artifact_kind` получает `roast_v1`.
- **v1**: первый контракт (dossier_2027).

## Правила изменения

1. **Внутри фазы — только добавление** необязательных полей. Удалять и переименовывать поля нельзя.
2. Ломающее изменение: `CONTRACT_VERSION` +1, обновить фикстуры, в PR отметить, что должна сделать другая сторона.
3. Фикстуры обязаны проходить свои схемы. Тест `contracts.test.ts` это проверяет в CI.
4. BE не отдаёт на фронт поля, которых нет в схеме. Ответ API прогоняется через `.parse()` перед отправкой.

## Моки на стороне FE

`src/lib/client/api.ts` — единственная точка, через которую FE ходит в API. При `NEXT_PUBLIC_USE_MOCKS=1` он отдаёт фикстуры и проигрывает `status-sequence.json` с задержкой ~2 с на шаг. Экран ожидания, ошибки и готовый артефакт FE строит, не дожидаясь BE.

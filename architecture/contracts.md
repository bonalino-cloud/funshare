# Контракты SERJ↔DAN (общая зона)

Контракт — единственное место, где зоны касаются друг друга. Код лежит в `src/contracts/`. Любое изменение — отдельная ветка `contracts/<что>` и ревью обоих.

## Файлы

```
src/contracts/
  generation.ts      GenerationRequest, GenerationStatus, ErrorCode
  profile.ts         ProfileSnapshot (нормализованный скрейп)      — только DAN
  persona.ts         PersonaProfile (источник истины)             — только DAN
  artifact.ts        ArtifactContent, Artifact (публичный вид)    — DAN пишет, SERJ рисует
  index.ts           реэкспорт + CONTRACT_VERSION
  fixtures/          готовые JSON-примеры для моков SERJ и тестов DAN
    status-sequence.json   последовательность статусов от queued до ready
    status-failed.json
    artifact-dossier.json  полный готовый артефакт с картинками-плейсхолдерами
```

## Эндпоинты

| Метод | Путь | Тело / ответ |
|---|---|---|
| `POST` | `/api/generations` | → `{ instagramUrl, mode: "self" \| "friend", kind: "dossier_2027" }`; ← `{ id }`. Ставит cookie `ownerToken` |
| `GET` | `/api/generations/:id` | ← `GenerationStatus`: `{ id, status, errorCode?, artifactSlug?, updatedAt }` |
| `GET` | `/api/artifacts/:slug` | ← `Artifact` (публичные данные, без сырых данных профиля) |
| `DELETE` | `/api/artifacts/:slug` | только с `ownerToken` владельца; ← `204` |

Страница `/a/[slug]` читает артефакт на сервере напрямую (server component), без HTTP-запроса к себе.

## Статусы

`queued → scraping → analyzing → writing → drawing → ready`, из любого — `failed`.

## Черновик `Artifact` (финализируется в фазе 0)

```ts
Artifact = {
  slug: string
  kind: "dossier_2027"
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

## Правила изменения

1. **Внутри фазы — только добавление** необязательных полей. Удалять и переименовывать поля нельзя.
2. Ломающее изменение: `CONTRACT_VERSION` +1, обновить фикстуры, в PR отметить, что должна сделать другая сторона.
3. Фикстуры обязаны проходить свои схемы. Тест `contracts.test.ts` это проверяет в CI.
4. DAN не отдаёт SERJ поля, которых нет в схеме. Ответ API прогоняется через `.parse()` перед отправкой.

## Моки на стороне SERJ

`src/lib/client/api.ts` — единственная точка, через которую SERJ ходит в API. При `NEXT_PUBLIC_USE_MOCKS=1` он отдаёт фикстуры и проигрывает `status-sequence.json` с задержкой ~2 с на шаг. Экран ожидания, ошибки и готовый артефакт SERJ строит, не дожидаясь DAN.

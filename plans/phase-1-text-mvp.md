# Фаза 1 — Текстовый MVP

**Цель:** пользователь вставляет ссылку на реальный профиль и через ≤ 60 с видит текстовое досье на странице `/a/[slug]`. Картинок пока нет, на их месте плейсхолдеры.

## BE

- [ ] `be/p1-generations-api` — `POST /api/generations` (валидация URL, извлечение `igUsername`, cookie `ownerToken`), `GET /api/generations/:id`
- [ ] `be/p1-workflow-skeleton` — Vercel Workflow с шагами-заглушками, смена статусов в БД, `stepTimings`
- [ ] `be/p1-scrape-step` — Apify → `ProfileSnapshot`, сырой ответ в private Blob, кэш 24 ч, ошибки `profile_not_found` / `profile_private`
- [ ] `be/p1-analyze-step` — `generateObject` → `PersonaProfile`, гардрейлы `likelyMinor` / `insufficientData`, промпт `v1`
- [ ] `be/p1-write-step` — `PersonaProfile` → `ArtifactContent` (без картинок), тон и запретные темы в системном промпте
- [ ] `be/p1-artifact-read` — `GET /api/artifacts/:slug`, серверная функция `getArtifact(slug)` для страницы
- [ ] `be/p1-cost-log` — учёт токенов и стоимости Apify на генерацию
- [ ] `be/p1-eval-set` — 10 реальных публичных профилей разных типов, скрипт прогона и сравнения версий промптов

## FE

- [ ] `fe/p1-landing` — лендинг: суть в одном экране, поле ссылки, переключатель «Для себя / Для друга», примеры артефактов
- [ ] `fe/p1-input-validation` — проверка ссылки на клиенте, понятные подсказки (`instagram.com/username`, `@username`)
- [ ] `fe/p1-progress-screen` — экран ожидания по статусам: человеческие фразы, анимация, ощущение движения на 60 с
- [ ] `fe/p1-error-states` — экран на каждый `errorCode` с действием («Попробовать другой профиль»)
- [ ] `fe/p1-artifact-page` — `/a/[slug]`: вёрстка досье по `Artifact.content`, плейсхолдеры под картинки, мобильная версия в приоритете
- [ ] `fe/p1-switch-to-real-api` — выключение моков на превью `dev`, проверка всего флоу вживую

## Точки синхронизации

1. `be/p1-generations-api` + `be/p1-workflow-skeleton` в `dev` → FE проверяет прогресс-экран на реальных статусах (шаги пока заглушки).
2. `be/p1-write-step` в `dev` → `fe/p1-switch-to-real-api`.
3. Если FE нужно новое поле в артефакте — сначала `contracts/<что>`, потом код.

## Definition of Done

- [ ] 8 из 10 профилей eval-сета дают `ready`, 2 закрытых/пустых — корректные ошибки
- [ ] p90 времени до `ready` ≤ 60 с
- [ ] Страница артефакта открывается по прямой ссылке в мобильном браузере
- [ ] Известна себестоимость одной текстовой генерации
- [ ] Тег `v0.1.0`

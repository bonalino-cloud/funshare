# Фаза 2 — Картинки, визуал, шаринг

**Цель:** готовый артефакт выглядит как дизайнерская вещь с 3–5 иллюстрациями, а ссылка в Telegram/WhatsApp/iMessage показывает красивое превью.

## BE

- [ ] `be/p2-image-model-test` — сравнить 2–3 модели картинок на eval-сете (стиль, консистентность, цена, время), зафиксировать выбор в `architecture/stack.md`
- [ ] `be/p2-image-prompts` — шаг `write` выдаёт `imagePrompts[]` с общим стилевым префиксом (стиль задаёт FE-дизайн, см. синхронизацию)
- [ ] `be/p2-draw-step` — параллельная генерация, WebP в public Blob, правило «меньше половины упало — собираем без них»
- [ ] `be/p2-assemble` — финальная сборка `Artifact.images`
- [ ] `be/p2-events-api` — `POST /api/artifacts/:slug/events` (`view`, `share_click`, `copy_link`, `cta_click`)
- [ ] `be/p2-delete` — `DELETE /api/artifacts/:slug` по `ownerToken`, удаление картинок

## FE

Сверено с кодом `dev` 2026-10-03. Формат артефакта сменился: 6 карточек 9:16 для сторис ([roast-engine.md §7.0](../architecture/roast-engine.md)), шаринг — в Instagram Stories.

- [x] `fe/p2-visual-style` — закрыто решением 2026-10-02: стиль и палитра фона из Figma вписаны в промпт холста (`draw-v1`, §7.0), отдельных рефов от FE не нужно
- [x] `fe/p2-roast-cards` — карточки 9:16 (Short / Medium / Long), подгонка шутки до 140 знаков, картинка + цвет фона из `punchImages`, экспорт PNG, полноэкранный просмотр (#36)
- [x] `fe/p2-share` (основа) — «Поделиться» = PNG 9:16 в системное меню → Instagram «История», ссылка в буфер; «Скачать все», «Ссылка»
- [x] `fe/p2-viral-cta` — на чужом артефакте «Прожарь в ответ» → `/create`
- [ ] 1. `fe/p2-cards-real-images` — проверить карточки на живых картинках BE: шов картинки и фона, градиент при неоднотонном фоне, карточка без картинки (упавшая клетка, Поджог). **Ждёт `be/p2-draw-step`**
- [ ] 2. `fe/p2-og-image` — `opengraph-image.tsx` для `/a/[slug]`: первая карточка в открытку 1200×630, кириллица, проверка в Telegram, WhatsApp, iMessage. **Ждёт `getArtifact(slug)`** (`be/p1-artifact-read`)
- [ ] 3. `fe/p2-share-events` — события `story_share`, `copy_link`, `cta_click`, `view`. **Ждёт `be/p2-events-api`**
- [ ] 4. `fe/p2-owner-controls` — у владельца «Удалить» (по `ownerToken`); «Ещё раз» уже есть на экране результата. **Ждёт `be/p2-delete`**

## Точки синхронизации

1. ~~`fe/p2-visual-style` → вход для `be/p2-image-prompts`~~ — стиль задан в промпте холста §7.0.
2. `contracts/images-v1`, если меняется форма `images`.
3. `be/p2-events-api` → `fe/p2-share-events`.

## Definition of Done

- [ ] 9 из 10 профилей eval-сета собираются с картинками, стиль единый
- [ ] p90 ≤ 90 с с картинками
- [ ] Превью ссылки корректно в Telegram, WhatsApp, iMessage
- [ ] События шаринга пишутся в БД
- [ ] Тег `v0.2.0`

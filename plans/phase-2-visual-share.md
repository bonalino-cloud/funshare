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

- [ ] `fe/p2-visual-style` — стиль иллюстраций: 2–3 референса и текстовое описание стиля для промптов (передать BE)
- [ ] `fe/p2-artifact-final` — финальная вёрстка с картинками, анимация раскрытия секций, альтернативная вёрстка для режима «Для друга»
- [ ] `fe/p2-og-image` — `opengraph-image.tsx` для `/a/[slug]`: картинка-открытка 1200×630, кириллица, проверка в Telegram и WhatsApp
- [ ] `fe/p2-share` — кнопки: Web Share API на мобильных, «Скопировать ссылку», Telegram, WhatsApp; события в `events`
- [ ] `fe/p2-viral-cta` — у зрителя чужого артефакта кнопка «Сделать такой же про себя»
- [ ] `fe/p2-owner-controls` — у владельца: «Удалить», «Сделать ещё»

## Точки синхронизации

1. `fe/p2-visual-style` → вход для `be/p2-image-prompts`. **Делать в начале фазы.**
2. `contracts/images-v1`, если меняется форма `images`.
3. `be/p2-events-api` → FE подключает события в `fe/p2-share`.

## Definition of Done

- [ ] 9 из 10 профилей eval-сета собираются с картинками, стиль единый
- [ ] p90 ≤ 90 с с картинками
- [ ] Превью ссылки корректно в Telegram, WhatsApp, iMessage
- [ ] События шаринга пишутся в БД
- [ ] Тег `v0.2.0`

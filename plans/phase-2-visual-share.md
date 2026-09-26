# Фаза 2 — Картинки, визуал, шаринг

**Цель:** готовый артефакт выглядит как дизайнерская вещь с 3–5 иллюстрациями, а ссылка в Telegram/WhatsApp/iMessage показывает красивое превью.

## DAN

- [ ] `dan/p2-kie-client` — клиент KIE API: `createTask`, вебхук `/api/webhooks/kie` с проверкой, запасной опрос `recordInfo`, копирование результата в Blob
- [ ] `dan/p2-image-variant-test` — GPT Image 2.5 Flare против Sunburst на eval-сете (стиль, единообразие серии, время), 1K против 2K; выбор записать в `architecture/stack.md`
- [ ] `dan/p2-image-prompts` — шаг `write` выдаёт `imagePrompts[]` с общим стилевым префиксом (стиль задаёт SERJ, см. синхронизацию)
- [ ] `dan/p2-draw-step` — параллельная генерация через KIE, WebP в public Blob, правило «меньше половины упало — собираем без них»
- [ ] `dan/p2-assemble` — финальная сборка `Artifact.images`
- [ ] `dan/p2-events-api` — `POST /api/artifacts/:slug/events` (`view`, `share_click`, `copy_link`, `cta_click`)
- [ ] `dan/p2-delete` — `DELETE /api/artifacts/:slug` по `ownerToken`, удаление картинок

## SERJ

- [ ] `serj/p2-visual-style` — стиль иллюстраций: 2–3 референса и текстовое описание стиля для промптов (передать DAN)
- [ ] `serj/p2-artifact-final` — финальная вёрстка с картинками, анимация раскрытия секций, альтернативная вёрстка для режима «Для друга»
- [ ] `serj/p2-og-image` — `opengraph-image.tsx` для `/a/[slug]`: картинка-открытка 1200×630, кириллица, проверка в Telegram и WhatsApp
- [ ] `serj/p2-share` — кнопки: Web Share API на мобильных, «Скопировать ссылку», Telegram, WhatsApp; события в `events`
- [ ] `serj/p2-viral-cta` — у зрителя чужого артефакта кнопка «Сделать такой же про себя»
- [ ] `serj/p2-owner-controls` — у владельца: «Удалить», «Сделать ещё»

## Точки синхронизации

1. `serj/p2-visual-style` → вход для `dan/p2-image-prompts`. **Делать в начале фазы.**
2. `contracts/images-v1`, если меняется форма `images`.
3. `dan/p2-events-api` → SERJ подключает события в `serj/p2-share`.

## Definition of Done

- [ ] 9 из 10 профилей eval-сета собираются с картинками, стиль единый
- [ ] p90 ≤ 90 с с картинками
- [ ] Превью ссылки корректно в Telegram, WhatsApp, iMessage
- [ ] События шаринга пишутся в БД
- [ ] Тег `v0.2.0`

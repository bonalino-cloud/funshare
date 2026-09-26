# Фаза 2 — Картинки, визуал, шаринг

**Цель:** готовый артефакт выглядит как дизайнерская вещь с 3–5 иллюстрациями, ссылка в Telegram/WhatsApp/iMessage показывает красивое превью, а артефакт **одной кнопкой уходит в Instagram Stories** вертикальной картинкой 9:16.

## DAN

- [ ] `dan/p2-kie-client` — клиент KIE API: `createTask`, вебхук `/api/webhooks/kie` с проверкой, запасной опрос `recordInfo`, копирование результата в Blob
- [ ] `dan/p2-image-variant-test` — GPT Image 2.5 Flare против Sunburst на eval-сете (стиль, единообразие серии, время), 1K против 2K; выбор записать в `architecture/stack.md`
- [ ] `dan/p2-image-prompts` — шаг `write` выдаёт `imagePrompts[]` с общим стилевым префиксом (стиль задаёт SERJ, см. синхронизацию)
- [ ] `dan/p2-draw-step` — параллельная генерация через KIE, WebP в public Blob, правило «меньше половины упало — собираем без них»
- [ ] `dan/p2-assemble` — финальная сборка `Artifact.images`
- [ ] `dan/p2-events-api` — `POST /api/artifacts/:slug/events` (`view`, `share_click`, `copy_link`, `story_share`, `cta_click`)
- [ ] `dan/p2-delete` — `DELETE /api/artifacts/:slug` по `ownerToken`, удаление картинок

## SERJ

- [ ] `serj/p2-visual-style` — стиль иллюстраций: 2–3 референса и текстовое описание стиля для промптов (передать DAN)
- [ ] `serj/p2-artifact-final` — финальная вёрстка с картинками, анимация раскрытия секций, альтернативная вёрстка для режима «Для друга»
- [ ] `serj/p2-og-image` — `opengraph-image.tsx` для `/a/[slug]`: картинка-открытка 1200×630, кириллица, проверка в Telegram и WhatsApp
- [ ] `serj/p2-story-template` — **обязательно для MVP.** Макет сторис 1080×1920 (9:16): hero-иллюстрация, заголовок, 2–3 самых ярких факта из досье, короткая ссылка на артефакт текстом. Безопасные зоны Instagram: верхние ~250 px и нижние ~340 px без важного контента
- [ ] `serj/p2-story-image` — **обязательно для MVP.** Картинка сторис из данных артефакта: `/a/[slug]/story.png` через `next/og` (`ImageResponse`), кириллица, иллюстрации из Blob, кэш на CDN
- [ ] `serj/p2-story-share` — **обязательно для MVP.** Кнопка «В сторис» — первая среди кнопок шаринга. На телефоне — `navigator.share({ files: [story.png] })`, в системном меню выбрать Instagram → Stories. Если браузер не умеет делиться файлами (десктоп, старые версии) — скачать PNG и показать инструкцию. После шаринга — подсказка «Добавь стикер «Ссылка», чтобы друзья открыли досье». Событие `story_share`
- [ ] `serj/p2-share` — остальные кнопки: Web Share API со ссылкой, «Скопировать ссылку», Telegram, WhatsApp; события в `events`
- [ ] `serj/p2-viral-cta` — у зрителя чужого артефакта кнопка «Сделать такой же про себя»
- [ ] `serj/p2-owner-controls` — у владельца: «Удалить», «Сделать ещё»

## Точки синхронизации

1. `serj/p2-visual-style` → вход для `dan/p2-image-prompts`. **Делать в начале фазы.**
2. `contracts/images-v1`, если меняется форма `images`.
3. `dan/p2-events-api` → SERJ подключает события в `serj/p2-share` и `serj/p2-story-share`.
4. `contracts/events-story-share` — новое значение `story_share` в типе события. Делать до `dan/p2-events-api`.

## Definition of Done

- [ ] 9 из 10 профилей eval-сета собираются с картинками, стиль единый
- [ ] p90 ≤ 90 с с картинками
- [ ] Превью ссылки корректно в Telegram, WhatsApp, iMessage
- [ ] **Stories:** на iPhone (Safari) и Android (Chrome) кнопка «В сторис» открывает системное меню, Instagram → Stories получает картинку 9:16 без обрезки; текст не залезает под интерфейс Instagram
- [ ] На десктопе PNG 1080×1920 скачивается, инструкция показана
- [ ] События шаринга пишутся в БД
- [ ] Тег `v0.2.0`

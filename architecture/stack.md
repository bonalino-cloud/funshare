# Технологический стек

Принцип выбора: одно приложение, один деплой, минимум инфраструктуры, которую надо администрировать. Два вайбкодера должны тратить время на продукт, а не на DevOps.

## Решение

| Слой | Выбор | Почему |
|---|---|---|
| Фреймворк | **Next.js (App Router) + TypeScript strict** | Фронт и API в одном репо и одном деплое; SSR для страницы артефакта (быстрый первый экран по ссылке из мессенджера) |
| UI | **Tailwind CSS v4 + shadcn/ui** | Быстрая сборка интерфейса, код компонентов лежит у нас, стилизуем под свой бренд |
| Анимации | **Motion** (framer-motion) | Анимация экрана ожидания и раскрытия артефакта |
| Превью для мессенджеров | **`next/og`** (`opengraph-image.tsx`) | Картинка-превью генерируется из данных артефакта, ссылка в Telegram/WhatsApp выглядит как открытка |
| Хостинг | **Vercel** | Превью-деплой на каждый PR, env, логи, аналитика из коробки |
| Конвейер | **Vercel Workflow** (`"use workflow"` / `"use step"`) | Генерация идёт 30–90 с и из нескольких шагов; каждый шаг ретраится отдельно, падение картинки не перезапускает скрейп |
| LLM | **AI SDK + `@ai-sdk/anthropic`**, текст — `claude-sonnet-5`, свой ключ Anthropic | `generateObject` + zod дают структурированный JSON; напрямую в Anthropic, расходы видны в console.anthropic.com |
| Картинки | **GPT Image 2.5 через KIE API** (kie.ai) | Тот же API, что у команды Visual в Claude Code. Два варианта модели с одной ценой — `gpt-image-2-5-flare-text-to-image` и `gpt-image-2-5-sunburst-text-to-image`: 1K — $0.03, 2K — $0.05, 4K — $0.08 за картинку. Вариант выбираем тестом в фазе 2; id модели — одна строка в конфиге |
| Скрейпинг | **Apify — Instagram Profile Scraper** (API) | Не держим свой скрейпер и прокси; платим за профиль |
| БД | **Postgres (Neon через Vercel Marketplace) + Drizzle ORM** | Схема в TypeScript, миграции в репо, отдельная ветка БД на превью |
| Файлы | **Vercel Blob** | Картинки артефактов (public) и сырой скрейп (private) |
| Защита | **Vercel BotID + rate limit** (Upstash Redis через Marketplace) | Каждая генерация стоит денег — боты и спам недопустимы |
| Валидация | **zod** | Одна схема на границе SERJ↔DAN и на выходе LLM |
| Тесты | **Vitest** (схемы, шаги конвейера), **Playwright** (сквозной флоу) | |
| CI | **GitHub Actions**: typecheck, lint, test на каждый PR | |
| Аналитика | **Vercel Web Analytics** + свои события в БД | Метрики из `business/INDEX.md` |

## Чего сознательно нет в MVP

- **Отдельного бэкенд-сервиса** (FastAPI, Nest и т. п.). Route handlers + Workflow закрывают задачу. Выносим, только если упрёмся.
- **Регистрации.** Генерация анонимная: владение артефактом держится на `ownerToken` в cookie. Аккаунты появятся в фазе 4 вместе с оплатой.
- **WebSocket/SSE.** Прогресс отдаём поллингом раз в 2 с. Проще, надёжнее, для 60 с ожидания хватает.
- **Монорепо с пакетами.** Одно приложение, зоны разделены папками и CODEOWNERS.

## Переменные окружения

| Переменная | Кто использует |
|---|---|
| `DATABASE_URL` | DAN |
| `BLOB_READ_WRITE_TOKEN` | DAN |
| `ANTHROPIC_API_KEY` — отдельный ключ проекта в console.anthropic.com | DAN |
| `APIFY_TOKEN` | DAN |
| `KIE_API_KEY` — отдельный ключ проекта, не личный ключ для Visual | DAN |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | DAN |
| `NEXT_PUBLIC_USE_MOCKS` | SERJ (`1` — работать на фикстурах) |
| `NEXT_PUBLIC_SITE_URL` | SERJ, DAN (ссылки для шаринга) |

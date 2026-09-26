# funshare

Ссылка на Instagram-профиль → ИИ-досье с прогнозом и иллюстрациями, которым легко поделиться.

- Продукт: [business/INDEX.md](business/INDEX.md)
- Правила репо и зоны: [CLAUDE.md](CLAUDE.md)
- Архитектура и стек: [architecture/INDEX.md](architecture/INDEX.md)
- Git-процесс и ветки: [architecture/git-workflow.md](architecture/git-workflow.md)
- План по фазам: [plans/INDEX.md](plans/INDEX.md)

## Локальный запуск

Нужны Node 22+ и pnpm.

```bash
pnpm install
cp .env.example .env.local   # или: vercel env pull .env.local
pnpm dev
```

Проверки (их же гоняет CI): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.

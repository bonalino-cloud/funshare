import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ALL_CANARIES } from "../../src/server/prompts/canary";
import { ANALYZE_SYSTEM } from "../../src/server/prompts/analyze/v1";
import { promptSources } from "../../src/server/roast/filters/prompt-leak";
import { collectNeedles, findLeaks } from "./bundle-leaks";

// CI: после `next build` ищем canary-строки и фразы системных промптов в том, что уходит в
// браузер (`.next/static`, `public/`). Находка = красный CI (roast-engine §8).
//
// Запуск: `pnpm exec tsx scripts/ci/check-bundle-leaks.ts [каталог ...]`.
// Без аргументов проверяет `.next/static`, `public` и пререндеренные страницы из `.next/server/app`
// (`.html`, `.rsc`: их отдают браузеру как есть; серверный JS там же не трогаем). В выводе только имена файлов и вид находки:
// сами строки промптов в лог CI не печатаем.

const ROOT = process.cwd();
const dirs = process.argv.slice(2);
const targets = dirs.length > 0 ? dirs : [join(".next", "static"), "public"];
/** Пререндер: HTML и RSC-ответы статических страниц уходят клиенту, серверные чанки нет. */
const PRERENDER_DIR = join(".next", "server", "app");
const PRERENDER_FILE = /\.(html|rsc)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function exists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// Папка сборки обязана быть: иначе проверка молча прошла бы по пустому месту.
const buildDir = targets[0]!;
if (!exists(buildDir)) {
  console.error(`Нет каталога ${buildDir}: сначала \`pnpm build\`.`);
  process.exit(2);
}

const needles = collectNeedles(ALL_CANARIES, [...promptSources(), ANALYZE_SYSTEM]);
const canaryCount = needles.filter((n) => n.kind === "canary").length;
if (canaryCount === 0 || needles.length <= canaryCount) {
  console.error("Список для поиска пуст: проверка ничего бы не нашла.");
  process.exit(2);
}

const prerendered =
  dirs.length === 0 && exists(PRERENDER_DIR)
    ? walk(PRERENDER_DIR).filter((path) => PRERENDER_FILE.test(path))
    : [];
const files = [...targets.filter(exists).flatMap(walk), ...prerendered].map((path) => ({
  path: relative(ROOT, path),
  content: readFileSync(path, "utf8"),
}));

const leaks = findLeaks(files, needles);
console.log(
  `Проверено файлов: ${files.length}, образцов: ${needles.length} (canary: ${canaryCount}).`,
);
if (leaks.length > 0) {
  const counts = new Map<string, number>();
  for (const leak of leaks) {
    const key = `[${leak.needle.kind}] в ${leak.file}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of counts) console.error(`УТЕЧКА ${key}: совпадений ${n}`);
  console.error("В клиентский бандл попал текст промпта или canary-строка. Сборка отклонена.");
  process.exit(1);
}
console.log("Утечек промптов в клиентском бандле нет.");

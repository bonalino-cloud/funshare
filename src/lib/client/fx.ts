/**
 * Отладочный выключатель WebGL-огня: `?nofx=all` гасит все шейдеры, `?nofx=hero,word` — только названные.
 * Слоты: hero (водоворот), word (маска «Получится огонь»), rules, final, footer, parallax (курсор и скролл hero). Нужен для замеров и
 * для проверки, что без WebGL страница остаётся читаемой.
 */
export function fxDisabled(slot: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = new URLSearchParams(window.location.search).get("nofx");
  if (!raw) return false;
  const list = raw.split(",");
  return list.includes("all") || list.includes(slot);
}

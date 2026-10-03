/** Копейки → «199 ₽». Копейки показываем только если они есть: 9950 → «99,50 ₽». */
export function formatRub(amount: number): string {
  const rub = Math.floor(amount / 100);
  const kop = amount % 100;
  return kop === 0 ? `${rub} ₽` : `${rub},${String(kop).padStart(2, "0")} ₽`;
}

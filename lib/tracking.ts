export function detectCarrier(tracking: string): string {
  const t = tracking.trim().toUpperCase();
  if (!t) return "Не определена";

  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t)) return "Почта России";
  if (/^\d{14}$/.test(t)) return "Почта России";

  if (/^\d{10}$/.test(t)) return "СДЭК";

  if (/^[A-Z]{2}\d{6,12}$/.test(t)) return "Boxberry";

  if (/^\d{12}$/.test(t)) return "Авито Доставка";

  if (/^\d{13}$/.test(t)) return "Яндекс Доставка";

  if (/^[A-Z0-9]{8,16}$/.test(t)) return "Транспортная компания";

  return "Не определена";
}

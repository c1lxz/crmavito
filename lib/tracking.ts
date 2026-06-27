export function detectCarrier(tracking: string): string {
  const raw = tracking.trim();
  if (!raw) return "Не определена";

  const t = raw.toUpperCase().replace(/[\s\-_]/g, "");
  const digits = t.replace(/\D/g, "");

  // Почта России: международный формат EE123456789RU
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t)) return "Почта России";

  // 5Post: префикс 50 + 12 цифр (14 всего) — проверяем ДО Почты России
  if (/^50\d{12}$/.test(t)) return "5Post";
  // DPD: 14 цифр, начинающихся с 0 — проверяем ДО Почты России
  if (/^0\d{13}$/.test(t)) return "DPD";

  // Почта России: внутренний 14 цифр
  if (/^\d{14}$/.test(t)) return "Почта России";

  // СДЭК: 10 цифр (накладная)
  if (/^\d{10}$/.test(t)) return "СДЭК";
  // СДЭК: 14xxxxxxxx
  if (/^14\d{8}$/.test(t)) return "СДЭК";

  // Авито Доставка: префикс AVT/AVD
  if (/^(AVT|AVD)\d{6,}$/.test(t)) return "Авито Доставка";
  // Авито Доставка: 12 цифр
  if (/^\d{12}$/.test(t)) return "Авито Доставка";
  // Авито Доставка: длинный формат 20–24 цифры (часто бывает)
  if (/^\d{20,24}$/.test(t)) return "Авито Доставка";

  // Яндекс Доставка: 13 цифр
  if (/^\d{13}$/.test(t)) return "Яндекс Доставка";

  // PickPoint: 9–11 цифр (как правило начинается с 7)
  if (/^7\d{8,10}$/.test(t)) return "PickPoint";

  // Boxberry: букв 2 + цифры
  if (/^[A-Z]{2}\d{6,12}$/.test(t)) return "Boxberry";

  // Общий catch-all для буквенно-цифровых трек-номеров
  if (/^[A-Z0-9]{8,30}$/.test(t)) return "Транспортная компания";

  // Если цифр в номере хотя бы 10 — считаем что это трек, но без идентификации
  if (digits.length >= 10) return "Транспортная компания";

  return "Не определена";
}

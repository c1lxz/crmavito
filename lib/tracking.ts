export type CarrierDetection = {
  carrier: string;
  confidence: "high" | "low";
};

/**
 * Определяет ТК по трек-номеру. Returns null, если трек пустой/распознать
 * невозможно — UI в этом случае показывает выпадающий список и сохраняет
 * выбор пользователя как fallback-данные для будущего улучшения.
 *
 * Конфликтующие форматы (10–11 цифр для Авито/СДЭК) разделены так:
 *   - 10 цифр                        → Авито (high), это CRM для Avito-продавца
 *   - 11 цифр, начинаются с 1        → СДЭК (high)
 *   - 11 цифр иначе                  → "Транспортная компания" (low)
 *   - 12 цифр                        → Авито (low)
 *   - 13 цифр                        → Яндекс (low)
 *   - 14 цифр                        → Почта (high), кроме 50…/0… (5Post/DPD)
 *   - 15 цифр                        → Почта (high)
 *   - буквенный однобуквенный префикс + 8–15 цифр (P04613648744) → Яндекс (high)
 */
export function detectCarrier(tracking: string): CarrierDetection | null {
  const raw = tracking.trim();
  if (!raw) return null;

  const t = raw.toUpperCase().replace(/[\s\-_]/g, "");
  const digits = t.replace(/\D/g, "");

  // --- буквенно-цифровые: однозначные ---

  // Почта России: международный UPU формат EE123456789RU
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t)) return { carrier: "Почта России", confidence: "high" };

  // Авито Доставка: явный префикс AVT/AVD
  if (/^(AVT|AVD)\d{6,}$/.test(t)) return { carrier: "Авито Доставка", confidence: "high" };

  // Boxberry: 2 буквы + 6–12 цифр
  if (/^[A-Z]{2}\d{6,12}$/.test(t)) return { carrier: "Boxberry", confidence: "high" };

  // Яндекс Доставка: одна заглавная буква + 8–15 цифр (P04613648744, M…)
  if (/^[A-Z]\d{8,15}$/.test(t)) return { carrier: "Яндекс Доставка", confidence: "high" };

  // --- чисто цифровые с особыми префиксами (до длинных правил) ---

  // 5Post: префикс 50 + 12 цифр (14 всего) — проверяем ДО Почты России
  if (/^50\d{12}$/.test(t)) return { carrier: "5Post", confidence: "high" };
  // DPD: 14 цифр, начинающихся с 0 — проверяем ДО Почты России
  if (/^0\d{13}$/.test(t)) return { carrier: "DPD", confidence: "high" };
  // PickPoint: 9–11 цифр с префиксом 7 — проверяем ДО СДЭК/Авито
  if (/^7\d{8,10}$/.test(t)) return { carrier: "PickPoint", confidence: "high" };

  // --- чисто цифровые по длине ---

  // Почта России: 15 цифр (например 805111822044340)
  if (/^\d{15}$/.test(t)) return { carrier: "Почта России", confidence: "high" };

  // Почта России: внутренний 14 цифр
  if (/^\d{14}$/.test(t)) return { carrier: "Почта России", confidence: "high" };

  // Яндекс Доставка: 13 цифр (исторический паттерн, ниже уверенность)
  if (/^\d{13}$/.test(t)) return { carrier: "Яндекс Доставка", confidence: "low" };

  // Авито Доставка: 12 цифр
  if (/^\d{12}$/.test(t)) return { carrier: "Авито Доставка", confidence: "low" };

  // СДЭК: 11 цифр, начинаются с 1 (10283054533 и т.п.) — приоритет над Авито
  if (/^1\d{10}$/.test(t)) return { carrier: "СДЭК", confidence: "high" };

  // Авито Доставка: 10 цифр (5112520982) — приоритет, это CRM для Avito
  if (/^\d{10}$/.test(t)) return { carrier: "Авито Доставка", confidence: "high" };

  // Авито Доставка: длинный формат 20–24 цифры
  if (/^\d{20,24}$/.test(t)) return { carrier: "Авито Доставка", confidence: "low" };

  // --- общий catch-all ---

  // Любой буквенно-цифровой трек 8–30 символов
  if (/^[A-Z0-9]{8,30}$/.test(t)) return { carrier: "Транспортная компания", confidence: "low" };

  // Если цифр в номере хотя бы 10 — считаем что это трек, но без идентификации
  if (digits.length >= 10) return { carrier: "Транспортная компания", confidence: "low" };

  return null;
}

/**
 * Удобный хелпер для мест, где нужна только строка (UI/Telegram).
 * Возвращает имя ТК или "Не определена", если трек распознать не удалось.
 */
export function detectCarrierName(tracking: string): string {
  return detectCarrier(tracking)?.carrier ?? "Не определена";
}

/** Список ТК для ручного выбора (выпадающий список fallback в UI). */
export const KNOWN_CARRIERS = [
  "Авито Доставка",
  "Почта России",
  "СДЭК",
  "Яндекс Доставка",
  "Boxberry",
  "5Post",
  "DPD",
  "PickPoint",
  "Транспортная компания",
] as const;

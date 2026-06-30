import { describe, expect, it } from "vitest";
import { detectCarrier, detectCarrierName } from "@/lib/tracking";

describe("detectCarrier — пользовательские примеры из задачи", () => {
  it("P04613648744 → Яндекс Доставка (high)", () => {
    expect(detectCarrier("P04613648744")).toEqual({ carrier: "Яндекс Доставка", confidence: "high" });
  });

  it("5112520982 → Авито Доставка (high)", () => {
    expect(detectCarrier("5112520982")).toEqual({ carrier: "Авито Доставка", confidence: "high" });
  });

  it("805111822044340 → Почта России (high)", () => {
    expect(detectCarrier("805111822044340")).toEqual({ carrier: "Почта России", confidence: "high" });
  });

  it("10283054533 → СДЭК (high)", () => {
    expect(detectCarrier("10283054533")).toEqual({ carrier: "СДЭК", confidence: "high" });
  });
});

describe("detectCarrier — Авито Доставка", () => {
  it("10 цифр с разными первыми — high", () => {
    expect(detectCarrier("1234567890")?.carrier).toBe("Авито Доставка");
    expect(detectCarrier("9876543210")?.carrier).toBe("Авито Доставка");
  });

  it("12 цифр — low (Авито)", () => {
    expect(detectCarrier("123456789012")).toEqual({ carrier: "Авито Доставка", confidence: "low" });
  });

  it("длинный формат 20+ цифр — low", () => {
    expect(detectCarrier("12345678901234567890")?.carrier).toBe("Авито Доставка");
    expect(detectCarrier("123456789012345678901234")?.carrier).toBe("Авито Доставка");
  });

  it("префикс AVT/AVD — high", () => {
    expect(detectCarrier("AVT12345678")).toEqual({ carrier: "Авито Доставка", confidence: "high" });
    expect(detectCarrier("AVD987654321")).toEqual({ carrier: "Авито Доставка", confidence: "high" });
  });
});

describe("detectCarrier — СДЭК", () => {
  it("11 цифр начинающихся с 1 — high", () => {
    expect(detectCarrier("10283054533")?.carrier).toBe("СДЭК");
    expect(detectCarrier("12345678901")?.carrier).toBe("СДЭК");
  });
});

describe("detectCarrier — Яндекс Доставка", () => {
  it("одна буква + 8–15 цифр — high", () => {
    expect(detectCarrier("P04613648744")?.carrier).toBe("Яндекс Доставка");
    expect(detectCarrier("M12345678")?.carrier).toBe("Яндекс Доставка");
    expect(detectCarrier("Y123456789012345")?.carrier).toBe("Яндекс Доставка");
  });

  it("13 цифр — low (исторический паттерн)", () => {
    expect(detectCarrier("1234567890123")).toEqual({ carrier: "Яндекс Доставка", confidence: "low" });
  });
});

describe("detectCarrier — Почта России", () => {
  it("международный формат RA123456789RU — high", () => {
    expect(detectCarrier("RA123456789RU")?.carrier).toBe("Почта России");
    expect(detectCarrier("EE987654321CN")?.carrier).toBe("Почта России");
  });

  it("внутренние 14 и 15 цифр — high", () => {
    expect(detectCarrier("12345678901234")?.carrier).toBe("Почта России");
    expect(detectCarrier("805111822044340")?.carrier).toBe("Почта России");
  });

  it("НЕ путает с 5Post (50 + 12 цифр)", () => {
    expect(detectCarrier("50111111111111")?.carrier).toBe("5Post");
  });

  it("НЕ путает с DPD (0 + 13 цифр)", () => {
    expect(detectCarrier("01234567890123")?.carrier).toBe("DPD");
  });
});

describe("detectCarrier — прочие ТК", () => {
  it("Boxberry: 2 буквы + 6–12 цифр", () => {
    expect(detectCarrier("BB123456789")?.carrier).toBe("Boxberry");
  });

  it("5Post: 50 + 12 цифр", () => {
    expect(detectCarrier("50123456789012")?.carrier).toBe("5Post");
  });

  it("DPD: 14 цифр начинающихся с 0", () => {
    expect(detectCarrier("01234567890123")?.carrier).toBe("DPD");
  });

  it("PickPoint: 9–11 цифр с префиксом 7 — приоритет над СДЭК", () => {
    expect(detectCarrier("712345678")?.carrier).toBe("PickPoint");
    expect(detectCarrier("71234567890")?.carrier).toBe("PickPoint");
  });
});

describe("detectCarrier — fallback", () => {
  it("буквенно-цифровой → Транспортная компания (low)", () => {
    expect(detectCarrier("ABC12345DEF")).toEqual({ carrier: "Транспортная компания", confidence: "low" });
    expect(detectCarrier("ZX9876543210123456789")?.carrier).toBe("Транспортная компания");
  });

  it("кириллица с цифрами >=10 → low fallback", () => {
    expect(detectCarrier("трек 1234567890")?.carrier).toBe("Транспортная компания");
  });

  it("пустая строка → null", () => {
    expect(detectCarrier("")).toBeNull();
    expect(detectCarrier("   ")).toBeNull();
  });

  it("слишком короткий мусор → null", () => {
    expect(detectCarrier("ABC")).toBeNull();
    expect(detectCarrier("12345")).toBeNull();
  });
});

describe("detectCarrier — нормализация ввода", () => {
  it("игнорирует пробелы/дефисы/подчёркивания", () => {
    expect(detectCarrier("1234 5678 90")?.carrier).toBe("Авито Доставка");
    expect(detectCarrier("1234-5678-90")?.carrier).toBe("Авито Доставка");
    expect(detectCarrier("12_34_56_78_90")?.carrier).toBe("Авито Доставка");
  });

  it("приводит к верхнему регистру", () => {
    expect(detectCarrier("ra123456789ru")?.carrier).toBe("Почта России");
    expect(detectCarrier("avt12345678")?.carrier).toBe("Авито Доставка");
  });
});

describe("detectCarrierName", () => {
  it("возвращает строку для UI", () => {
    expect(detectCarrierName("5112520982")).toBe("Авито Доставка");
  });

  it("возвращает 'Не определена' для пустого/мусора", () => {
    expect(detectCarrierName("")).toBe("Не определена");
    expect(detectCarrierName("ABC")).toBe("Не определена");
  });
});

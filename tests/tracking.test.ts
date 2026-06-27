import { describe, expect, it } from "vitest";
import { detectCarrier } from "@/lib/tracking";

describe("detectCarrier", () => {
  describe("Почта России", () => {
    it("определяет международный формат EE123456789RU", () => {
      expect(detectCarrier("RA123456789RU")).toBe("Почта России");
      expect(detectCarrier("EE987654321CN")).toBe("Почта России");
    });

    it("определяет внутренний 14-значный формат", () => {
      expect(detectCarrier("12345678901234")).toBe("Почта России");
    });
  });

  describe("СДЭК", () => {
    it("определяет 10 цифр", () => {
      expect(detectCarrier("1234567890")).toBe("СДЭК");
    });

    it("определяет формат 14xxxxxxxx", () => {
      expect(detectCarrier("1412345678")).toBe("СДЭК");
    });
  });

  describe("Boxberry", () => {
    it("определяет формат XX000000", () => {
      expect(detectCarrier("BB123456789")).toBe("Boxberry");
    });
  });

  describe("Авито Доставка", () => {
    it("определяет 12 цифр", () => {
      expect(detectCarrier("123456789012")).toBe("Авито Доставка");
    });

    it("определяет длинный формат 20+ цифр", () => {
      expect(detectCarrier("12345678901234567890")).toBe("Авито Доставка");
      expect(detectCarrier("123456789012345678901234")).toBe("Авито Доставка");
    });

    it("определяет префикс AVT/AVD", () => {
      expect(detectCarrier("AVT12345678")).toBe("Авито Доставка");
      expect(detectCarrier("AVD987654321")).toBe("Авито Доставка");
    });
  });

  describe("Яндекс Доставка", () => {
    it("определяет 13 цифр", () => {
      expect(detectCarrier("1234567890123")).toBe("Яндекс Доставка");
    });
  });

  describe("5Post", () => {
    it("определяет префикс 50 + 12 цифр", () => {
      expect(detectCarrier("50123456789012")).toBe("5Post");
    });
  });

  describe("DPD", () => {
    it("определяет 14 цифр начинающихся с 0", () => {
      expect(detectCarrier("01234567890123")).toBe("DPD");
    });
  });

  describe("Транспортная компания (catch-all)", () => {
    it("определяет буквенно-цифровой трек длиной до 30", () => {
      expect(detectCarrier("ABC12345DEF")).toBe("Транспортная компания");
      expect(detectCarrier("ZX9876543210123456789")).toBe("Транспортная компания");
    });

    it("определяет любой трек с >=10 цифрами (fallback)", () => {
      // Содержит кириллицу — не попадает в специфичные regex, но цифр достаточно
      expect(detectCarrier("трек 1234567890")).toBe("Транспортная компания");
    });
  });

  describe("Не определена", () => {
    it("возвращает 'Не определена' для пустой строки", () => {
      expect(detectCarrier("")).toBe("Не определена");
      expect(detectCarrier("   ")).toBe("Не определена");
    });

    it("возвращает 'Не определена' для короткого мусора", () => {
      expect(detectCarrier("ABC")).toBe("Не определена");
      expect(detectCarrier("12345")).toBe("Не определена");
    });
  });

  describe("нормализация ввода", () => {
    it("игнорирует пробелы, дефисы и подчёркивания", () => {
      expect(detectCarrier("1234 5678 90")).toBe("СДЭК");
      expect(detectCarrier("1234-5678-90")).toBe("СДЭК");
    });

    it("приводит к верхнему регистру", () => {
      expect(detectCarrier("ra123456789ru")).toBe("Почта России");
      expect(detectCarrier("avt12345678")).toBe("Авито Доставка");
    });
  });
});

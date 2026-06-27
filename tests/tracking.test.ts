import { describe, expect, it } from "vitest";
import { detectCarrier } from "@/lib/tracking";

describe("detectCarrier", () => {
  describe("Авито Доставка (приоритет — это CRM для Avito)", () => {
    it("определяет реальный трек пользователя 5112520982", () => {
      expect(detectCarrier("5112520982")).toBe("Авито Доставка");
      // С пробелами как ввёл пользователь
      expect(detectCarrier("511 252 0982")).toBe("Авито Доставка");
    });

    it("определяет 10 цифр как Авито (а не СДЭК)", () => {
      expect(detectCarrier("1234567890")).toBe("Авито Доставка");
      expect(detectCarrier("9876543210")).toBe("Авито Доставка");
    });

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

  describe("Почта России", () => {
    it("определяет международный формат EE123456789RU", () => {
      expect(detectCarrier("RA123456789RU")).toBe("Почта России");
      expect(detectCarrier("EE987654321CN")).toBe("Почта России");
    });

    it("определяет внутренний 14-значный формат", () => {
      expect(detectCarrier("12345678901234")).toBe("Почта России");
    });

    it("НЕ путает с 5Post (50 + 12 цифр = 14)", () => {
      expect(detectCarrier("50111111111111")).toBe("5Post");
    });

    it("НЕ путает с DPD (0 + 13 цифр = 14)", () => {
      expect(detectCarrier("01234567890123")).toBe("DPD");
    });
  });

  describe("Boxberry", () => {
    it("определяет формат XX000000", () => {
      expect(detectCarrier("BB123456789")).toBe("Boxberry");
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

  describe("PickPoint", () => {
    it("определяет 9–11 цифр с префиксом 7", () => {
      expect(detectCarrier("712345678")).toBe("PickPoint");
      expect(detectCarrier("71234567890")).toBe("PickPoint");
    });
  });

  describe("Транспортная компания (catch-all)", () => {
    it("определяет буквенно-цифровой трек", () => {
      expect(detectCarrier("ABC12345DEF")).toBe("Транспортная компания");
      expect(detectCarrier("ZX9876543210123456789")).toBe("Транспортная компания");
    });

    it("определяет любой трек с >=10 цифрами (fallback на цифры)", () => {
      // Содержит кириллицу — не попадает в строгие regex, но цифр достаточно
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
      expect(detectCarrier("1234 5678 90")).toBe("Авито Доставка");
      expect(detectCarrier("1234-5678-90")).toBe("Авито Доставка");
      expect(detectCarrier("12_34_56_78_90")).toBe("Авито Доставка");
    });

    it("приводит к верхнему регистру", () => {
      expect(detectCarrier("ra123456789ru")).toBe("Почта России");
      expect(detectCarrier("avt12345678")).toBe("Авито Доставка");
    });
  });
});

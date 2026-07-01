import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const orderDetailSource = readFileSync(
  path.resolve(__dirname, "../components/orders/order-detail-client.tsx"),
  "utf8"
);

describe("OrderDetailClient — UI structure (smoke)", () => {
  it("содержит кнопку 'Открыть штрихкод' для открытия модала", () => {
    expect(orderDetailSource).toContain("Открыть штрихкод");
  });

  it("использует createPortal для рендера модала вне родительского дерева", () => {
    expect(orderDetailSource).toContain("createPortal");
    expect(orderDetailSource).toContain("document.body");
  });

  it("задаёт z-index 9999 на модале (выше дока и тостов)", () => {
    expect(orderDetailSource).toContain("9999");
  });

  it("закрывает модал по кнопкам 'Закрыть' и крестику", () => {
    expect(orderDetailSource).toContain("setShowBarcode(false)");
    expect(orderDetailSource).toContain("Закрыть");
  });

  it("включает кнопку 'Скачать' с download-атрибутом", () => {
    expect(orderDetailSource).toContain("Скачать");
    expect(orderDetailSource).toMatch(/download=\{`barcode-/);
  });

  it("блокирует фоновый скролл при открытии модала", () => {
    expect(orderDetailSource).toContain("document.body.style.overflow");
  });

  it("модал показывает трек-номер и ТК (с fallback на detectCarrierName)", () => {
    expect(orderDetailSource).toContain("order.trackingNumber");
    expect(orderDetailSource).toContain("order.carrier || detectCarrierName(order.trackingNumber)");
  });
});

const createOrderDialogSource = readFileSync(
  path.resolve(__dirname, "../components/orders/create-order-dialog.tsx"),
  "utf8"
);

describe("CreateOrderDialog — UI structure (smoke)", () => {
  it("показывает причину ошибки фото товара", () => {
    expect(createOrderDialogSource).toContain("productImageError");
  });

  it("использует определение ТК и поддерживает ручной ввод carrier", () => {
    expect(createOrderDialogSource).toContain("detectCarrier");
    expect(createOrderDialogSource).toContain("detectedCarrier");
    expect(createOrderDialogSource).toContain("KNOWN_CARRIERS");
  });

  it("содержит поле даты заказа", () => {
    expect(createOrderDialogSource).toContain("Дата заказа");
  });

  it("не содержит inline-форму создания контрагента (вынесено в Справочники)", () => {
    expect(createOrderDialogSource).not.toContain("handleCreateCounterparty");
    expect(createOrderDialogSource).toContain("/counterparties");
  });
});

const bottomNavSource = readFileSync(
  path.resolve(__dirname, "../components/layout/bottom-nav.tsx"),
  "utf8"
);
const dockSource = readFileSync(
  path.resolve(__dirname, "../components/ui/dock.tsx"),
  "utf8"
);

describe("BottomNav / Dock — UI structure (smoke)", () => {
  it("док не использует whileHover (залипание после тапа)", () => {
    expect(dockSource).not.toContain("whileHover");
  });

  it("док использует Link с prefetch, а не router.push", () => {
    expect(dockSource).toContain("prefetch");
    expect(bottomNavSource).not.toContain("router.push");
  });

  it("док подсвечивает активный пункт через usePathname", () => {
    expect(bottomNavSource).toContain("usePathname");
    expect(bottomNavSource).toContain("activeHref");
  });

  it("фон дока доходит до низа экрана, а safe-area находится внутри него", () => {
    expect(bottomNavSource).not.toContain("pb-[var(--app-bottom-pad");
    expect(dockSource).toContain("pb-[calc(0.375rem+var(--app-bottom-pad");
  });
});

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

  it("модал показывает трек-номер и ТК", () => {
    expect(orderDetailSource).toContain("order.trackingNumber");
    expect(orderDetailSource).toContain("order.carrier || detectCarrier(order.trackingNumber)");
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

  it("позволяет вручную указать фото товара и ТК", () => {
    expect(createOrderDialogSource).toContain("productImageUrl");
    expect(createOrderDialogSource).toContain("URL фото товара");
    expect(createOrderDialogSource).toContain("carrier");
    expect(createOrderDialogSource).toContain("detectedCarrier");
  });

  it("на узких экранах переносит дату заказа на отдельную строку", () => {
    expect(createOrderDialogSource).toContain("min-[430px]:grid-cols-2");
    expect(createOrderDialogSource).toContain("Дата заказа");
  });

  it("содержит inline-форму создания контрагента", () => {
    expect(createOrderDialogSource).toContain("handleCreateCounterparty");
    expect(createOrderDialogSource).toContain("/api/counterparties");
    expect(createOrderDialogSource).toContain("router.refresh");
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
});

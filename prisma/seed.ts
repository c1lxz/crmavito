import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Admin user
  const adminHash = await hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@crmavito.ru" },
    update: {},
    create: { name: "Администратор", email: "admin@crmavito.ru", passwordHash: adminHash, role: "ADMIN" },
  });

  // Manager user
  const managerHash = await hash("manager123", 12);
  await prisma.user.upsert({
    where: { email: "manager@crmavito.ru" },
    update: {},
    create: { name: "Иван Петров", email: "manager@crmavito.ru", passwordHash: managerHash, role: "MANAGER" },
  });

  // Products
  const p1 = await prisma.product.upsert({
    where: { avitoItemId: "demo-001" },
    update: {},
    create: { name: "iPhone 15 Pro 128GB", salePrice: 89990, avitoItemId: "demo-001", avitoListingStatus: "active" },
  });
  const p2 = await prisma.product.upsert({
    where: { avitoItemId: "demo-002" },
    update: {},
    create: { name: "AirPods Pro 2", salePrice: 18990, avitoItemId: "demo-002", avitoListingStatus: "active" },
  });
  const p3 = await prisma.product.upsert({
    where: { avitoItemId: "demo-003" },
    update: {},
    create: { name: "Samsung Galaxy Watch 6", salePrice: 24990, avitoItemId: "demo-003", avitoListingStatus: "active" },
  });
  const p4 = await prisma.product.upsert({
    where: { avitoItemId: "demo-004" },
    update: {},
    create: { name: "Sony PlayStation 5", salePrice: 49990, avitoItemId: "demo-004", avitoListingStatus: "active" },
  });

  // Counterparties
  const cp1 = await prisma.counterparty.upsert({
    where: { id: "cp-demo-001" },
    update: {},
    create: { id: "cp-demo-001", name: "ООО ТехноТрейд", contactInfo: "+7 (495) 123-45-67", comment: "Основной поставщик электроники" },
  });
  const cp2 = await prisma.counterparty.upsert({
    where: { id: "cp-demo-002" },
    update: {},
    create: { id: "cp-demo-002", name: "ИП Сидоров М.В.", contactInfo: "@sidorov_supply", comment: "Надёжный поставщик" },
  });

  // Orders
  const now = new Date();
  const orders = [
    { orderNumber: "0001", product: p1, cp: cp1, qty: 1, salePrice: 89990, buyPrice: 72000, tracking: "1234567890", city: "Москва", variant: "Натуральный титан", status: "RECEIVED" as const, daysAgo: 5, logist: 450, commission: 2700 },
    { orderNumber: "0002", product: p2, cp: cp1, qty: 1, salePrice: 18990, buyPrice: 14500, tracking: "1234567891", city: "Санкт-Петербург", variant: "Белый", status: "SHIPPED" as const, daysAgo: 3, logist: 350, commission: 570 },
    { orderNumber: "0003", product: p3, cp: cp2, qty: 1, salePrice: 24990, buyPrice: 18000, tracking: "1234567892", city: "Казань", variant: "Чёрный", status: "RECEIVED" as const, daysAgo: 2, logist: 400, commission: 750 },
    { orderNumber: "0004", product: p4, cp: cp1, qty: 1, salePrice: 49990, buyPrice: 40000, tracking: "1234567893", city: "Екатеринбург", variant: null, status: "RETURNING" as const, daysAgo: 7, logist: 600, commission: 1500 },
    { orderNumber: "0005", product: p1, cp: cp2, qty: 1, salePrice: 89990, buyPrice: 72000, tracking: "1234567894", city: "Новосибирск", variant: "Чёрный", status: "RECEIVED" as const, daysAgo: 1, logist: 500, commission: 2700 },
    { orderNumber: "0006", product: p2, cp: cp1, qty: 2, salePrice: 18990, buyPrice: 14500, tracking: "1234567895", city: "Москва", variant: "Белый", status: "ACCEPTED" as const, daysAgo: 0, logist: 0, commission: 0 },
  ];

  for (const o of orders) {
    const orderDate = new Date(now);
    orderDate.setDate(orderDate.getDate() - o.daysAgo);
    const existing = await prisma.order.findUnique({ where: { orderNumber: o.orderNumber } });
    if (existing) continue;

    const receivedAt = o.status === "RECEIVED" || o.status === "RETURNING" ? new Date(orderDate) : null;
    if (receivedAt) receivedAt.setDate(receivedAt.getDate() + 2);

    const order = await prisma.order.create({
      data: {
        orderNumber: o.orderNumber,
        productId: o.product.id,
        productNameSnapshot: o.product.name,
        variant: o.variant,
        quantity: o.qty,
        salePriceAtOrder: o.salePrice,
        counterpartyId: o.cp.id,
        purchasePricePerUnit: o.buyPrice,
        trackingNumber: o.tracking,
        orderDate,
        shippingDate: o.status !== "ACCEPTED" ? new Date(orderDate.getTime() + 86400000) : null,
        receivedAt,
        destinationCity: o.city,
        status: o.status,
        logisticsCost: o.logist,
        commissionCost: o.commission,
        createdByUserId: admin.id,
      },
    });

    await prisma.auditLog.create({
      data: { entityType: "ORDER", entityId: order.id, userId: admin.id, fieldName: "status", newValue: "ACCEPTED" },
    });

    if (o.status === "RETURNING") {
      await prisma.return.create({
        data: {
          orderId: order.id,
          productId: o.product.id,
          trackingNumber: o.tracking,
          status: "RETURNING",
          reason: "Не подошёл размер",
          shippingDate: order.shippingDate,
        },
      });
    }
  }

  // Expenses
  const expenseData = [
    { category: "LOGISTICS" as const, amount: 4250, title: "Доставка заказов", paymentMethod: "Тинькофф", daysAgo: 1 },
    { category: "ADVERTISING" as const, amount: 8900, title: "Реклама в Avito", paymentMethod: "Тинькофф", daysAgo: 3 },
    { category: "AVITO_COMMISSION" as const, amount: 6450, title: "Комиссии Avito", paymentMethod: "Тинькофф", daysAgo: 5 },
    { category: "PACKAGING" as const, amount: 2300, title: "Упаковочные материалы", paymentMethod: "Наличные", daysAgo: 7 },
    { category: "OTHER" as const, amount: 1250, title: "Прочие расходы", paymentMethod: "Наличные", daysAgo: 10 },
  ];

  for (const e of expenseData) {
    const date = new Date(now);
    date.setDate(date.getDate() - e.daysAgo);
    await prisma.expense.create({
      data: { date, category: e.category, amount: e.amount, title: e.title, paymentMethod: e.paymentMethod, createdByUserId: admin.id },
    });
  }

  console.log("✅ Seed completed!");
  console.log("👤 Admin: admin@crmavito.ru / admin123");
  console.log("👤 Manager: manager@crmavito.ru / manager123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

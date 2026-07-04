import { z } from "zod";

export const orderItemInputSchema = z.object({
  productId: z.string().uuid(),
  variant: z.string().trim().optional(),
  size: z.string().trim().optional(),
  quantity: z.number().int().positive(),
  salePriceAtOrder: z.number().positive(),
  purchasePricePerUnit: z.number().nonnegative(),
  imageUrls: z.array(z.string().trim().min(1)).max(9).default([]),
  sourceReturnId: z.string().uuid().nullable().optional(),
});

export const orderFieldsSchema = z.object({
  counterpartyId: z.string().uuid(),
  purchaseComment: z.string().trim().optional(),
  trackingNumber: z.string().trim().min(1),
  carrier: z.string().trim().optional(),
  orderDate: z.string().date(),
  shippingDate: z.string().date().nullable().optional(),
  destinationCity: z.string().trim().optional(),
  logisticsCost: z.number().nonnegative().default(0),
  commissionCost: z.number().nonnegative().default(0),
  otherCosts: z.number().nonnegative().default(0),
});

export const createOrderSchema = orderFieldsSchema.extend({
  items: z.array(orderItemInputSchema).min(1).max(9),
});

export const updateOrderSchema = createOrderSchema.partial().extend({
  items: z.array(orderItemInputSchema).min(1).max(9).optional(),
});

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export function getLegacyOrderTotals(items: OrderItemInput[]) {
  return {
    quantity: 1,
    salePriceAtOrder: items.reduce((sum, item) => sum + item.salePriceAtOrder * item.quantity, 0),
    purchasePricePerUnit: items.reduce(
      (sum, item) => sum + item.purchasePricePerUnit * item.quantity,
      0
    ),
  };
}

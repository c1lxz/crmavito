"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";

export interface ProductProfit {
  productId: string;
  name: string;
  imageUrl: string | null;
  profit: number;
}

interface Props {
  products: ProductProfit[];
}

export function TopProductsProfit({ products }: Props) {
  const maxProfit = Math.max(...products.map((p) => p.profit), 1);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-4">Прибыль по товарам</h3>

        {products.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Нет данных за период</p>
        ) : (
          <div className="space-y-4">
            {products.map((product) => {
              const pct = Math.max((product.profit / maxProfit) * 100, 4);
              return (
                <div key={product.productId} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {product.imageUrl ? (
                      <Image
                        src={product.imageUrl}
                        alt={product.name}
                        width={36}
                        height={36}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      product.name.charAt(0).toUpperCase()
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate mb-1.5">{product.name}</p>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <span className="report-value text-xs font-bold whitespace-nowrap">
                    {product.profit.toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

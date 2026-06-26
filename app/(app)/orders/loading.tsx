import { OrderRowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function OrdersLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="app-header">
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-24 flex-1" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>

      <div className="px-4 pt-4 space-y-10">
        {Array.from({ length: 5 }).map((_, i) => (
          <OrderRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

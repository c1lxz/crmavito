import { CardSkeleton, OrderRowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="app-header">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-10 w-10 rounded-md" />
        </div>
      </div>

      <div className="px-4 space-y-5 pb-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>

        <div>
          <Skeleton className="h-4 w-32 mb-3" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </div>
        </div>

        <div>
          <Skeleton className="h-4 w-36 mb-3" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <OrderRowSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

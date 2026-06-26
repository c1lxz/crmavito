import { OrderRowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ReturnsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-[var(--app-top-pad)] pb-3">
        <Skeleton className="h-6 w-32 mb-3" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="px-4 py-3 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <OrderRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

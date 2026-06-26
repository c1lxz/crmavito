import { ProductRowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ProductsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="app-header">
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-32 flex-1" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>

      <div className="px-4 pt-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ProductRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

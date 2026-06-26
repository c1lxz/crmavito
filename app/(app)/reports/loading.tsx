import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-[var(--app-top-pad)] pb-3">
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}

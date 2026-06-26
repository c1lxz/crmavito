import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="app-header">
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

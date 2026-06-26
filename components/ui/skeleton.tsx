import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/60",
        className
      )}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-12 w-12 rounded-xl" />
      </div>
      <Skeleton className="h-5 w-24" />
    </div>
  );
}

export function OrderRowSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-1.5 flex-shrink-0">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function ProductRowSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
      <Skeleton className="h-14 w-14 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

export { Skeleton };

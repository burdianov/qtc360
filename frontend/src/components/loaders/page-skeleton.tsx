import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface PageSkeletonProps {
  showAction?: boolean
  className?: string
}

function PageSkeleton({ showAction = true, className }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className={cn("space-y-6", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        {showAction && <Skeleton className="h-8 w-32" />}
      </div>
    </div>
  )
}

export { PageSkeleton }
export type { PageSkeletonProps }

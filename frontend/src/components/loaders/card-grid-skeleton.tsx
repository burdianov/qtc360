import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface CardSkeletonProps {
  className?: string
  lines?: number
}

function CardSkeleton({ className, lines = 2 }: CardSkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-xs",
        className
      )}
    >
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-8 w-16 mb-3" />
      {lines > 0 && Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3 mt-2"
          style={{ width: `${55 + (i * 18) % 35}%` }}
        />
      ))}
    </div>
  )
}

interface CardGridSkeletonProps {
  count?: number
  className?: string
  itemClassName?: string
  lines?: number
}

function CardGridSkeleton({
  count = 4,
  className,
  itemClassName,
  lines = 2,
}: CardGridSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading cards"
      className={cn(
        "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton
          key={i}
          lines={lines}
          className={itemClassName}
        />
      ))}
    </div>
  )
}

export { CardGridSkeleton, CardSkeleton }
export type { CardGridSkeletonProps, CardSkeletonProps }

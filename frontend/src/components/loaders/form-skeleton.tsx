import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface FormSkeletonProps {
  fields?: number
  showHeader?: boolean
  className?: string
}

function FormSkeleton({
  fields = 5,
  showHeader = true,
  className,
}: FormSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading form"
      className={cn("space-y-6", className)}
    >
      {showHeader && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      )}

      <div className="rounded-lg border bg-card p-6 shadow-xs space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  )
}

export { FormSkeleton }
export type { FormSkeletonProps }

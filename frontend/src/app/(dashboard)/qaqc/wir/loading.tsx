import { Skeleton } from "@/components/ui/skeleton"
import { TableSkeleton } from "@/components/loaders/table-skeleton"

export default function WIRLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading WIR page">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <TableSkeleton />
    </div>
  )
}

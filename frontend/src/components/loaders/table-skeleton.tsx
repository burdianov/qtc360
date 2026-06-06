import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

interface TableSkeletonProps {
  rows?: number
  columns?: number
  showHeader?: boolean
  showToolbar?: boolean
  className?: string
}

function TableSkeleton({
  rows = 8,
  columns = 5,
  showHeader = true,
  showToolbar = true,
  className,
}: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading table"
      className={cn("space-y-3", className)}
    >
      {showToolbar && (
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-8 w-[150px] lg:w-[250px]" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        <Table>
          {showHeader && (
            <TableHeader>
              <TableRow>
                {Array.from({ length: columns }).map((_, i) => (
                  <TableHead key={i}>
                    <Skeleton className="h-3.5 w-20" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <TableRow key={rowIndex}>
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <TableCell key={colIndex}>
                    <Skeleton
                      className="h-4"
                      style={{
                        width: `${60 + ((rowIndex * 13 + colIndex * 37) % 35)}%`,
                      }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export { TableSkeleton }
export type { TableSkeletonProps }

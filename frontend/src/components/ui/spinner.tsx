import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

type SpinnerSize = "sm" | "default" | "lg" | "xl"

const sizeClassMap: Record<SpinnerSize, string> = {
  sm: "h-3.5 w-3.5",
  default: "h-4 w-4",
  lg: "h-6 w-6",
  xl: "h-8 w-8",
}

interface SpinnerProps {
  size?: SpinnerSize
  className?: string
  label?: string
}

function Spinner({ size = "default", className, label = "Loading" }: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn(
        "animate-spin text-muted-foreground motion-reduce:animate-none",
        sizeClassMap[size],
        className
      )}
    />
  )
}

export { Spinner }
export type { SpinnerProps, SpinnerSize }

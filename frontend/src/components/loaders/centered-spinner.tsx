import { Spinner, type SpinnerSize } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface CenteredSpinnerProps {
  size?: SpinnerSize
  label?: string
  className?: string
  minHeight?: string
}

function CenteredSpinner({
  size = "lg",
  label = "Loading…",
  className,
  minHeight = "min-h-[50vh]",
}: CenteredSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3",
        minHeight,
        className
      )}
    >
      <Spinner size={size} className="text-foreground/70" />
      {label && (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
    </div>
  )
}

export { CenteredSpinner }
export type { CenteredSpinnerProps }

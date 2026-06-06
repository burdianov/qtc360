import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="flex min-h-[60vh] w-full items-center justify-center p-6"
    >
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-primary/10 motion-reduce:hidden" />
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <Loader2 className="h-7 w-7 animate-spin text-primary motion-reduce:animate-none" />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-foreground">Loading…</p>
          <p className="text-xs text-muted-foreground">
            Please wait a moment
          </p>
        </div>
        <div className="flex items-center gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse motion-reduce:animate-none [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse motion-reduce:animate-none [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  )
}

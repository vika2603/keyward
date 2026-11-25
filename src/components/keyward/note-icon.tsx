import { StickyNoteIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** The tile a secure note shows where a login shows its site icon. */
export function NoteIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        className,
      )}
    >
      <StickyNoteIcon className="size-4" />
    </span>
  )
}

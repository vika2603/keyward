import { SearchIcon, XIcon } from "lucide-react"
import type { RefObject } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n"

/** The search box over the main list; the arrow down key and Enter reach the list's first row. */
export function SearchBar({
  query,
  onQuery,
  inputRef,
  onFocusFirstRow,
  onOpenFirstRow,
}: {
  query: string
  onQuery: (query: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  onFocusFirstRow: () => void
  onOpenFirstRow: () => void
}) {
  return (
    <div className="flex gap-1.5 px-2 pb-2">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // While an input method composes text, Enter, Escape and the arrows belong to it.
            if (event.nativeEvent.isComposing) return
            // Escape clears a search before it closes the popup.
            if (event.key === "Escape" && query) {
              event.preventDefault()
              onQuery("")
            } else if (event.key === "ArrowDown") {
              event.preventDefault()
              onFocusFirstRow()
            } else if (event.key === "Enter") {
              onOpenFirstRow()
            }
          }}
          placeholder={t("popup.main.search")}
          aria-label={t("popup.main.search")}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-1 right-1.5 text-muted-foreground"
            aria-label={t("popup.main.clearSearch")}
            title={t("popup.main.clearSearch")}
            onClick={() => {
              onQuery("")
              inputRef.current?.focus()
            }}
          >
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

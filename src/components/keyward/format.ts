import { currentLanguage, type Language } from "@/lib/i18n"

/**
 * One formatter per language and options, made on first use. Building an Intl formatter is far
 * slower than using one, and lists and rows format on every render.
 */
function cached<Formatter>(
  make: (language: Language) => Formatter,
): () => Formatter {
  const formatters = new Map<Language, Formatter>()
  return () => {
    const language = currentLanguage()
    let formatter = formatters.get(language)
    if (!formatter) {
      formatter = make(language)
      formatters.set(language, formatter)
    }
    return formatter
  }
}

const dateTimeFormat = cached(
  (language) =>
    new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
)
const dateFormat = cached(
  (language) => new Intl.DateTimeFormat(language, { dateStyle: "medium" }),
)
const dayFormat = cached(
  (language) =>
    new Intl.DateTimeFormat(language, { month: "long", day: "numeric" }),
)
const relativeTimeFormat = cached(
  (language) => new Intl.RelativeTimeFormat(language, { numeric: "auto" }),
)
const nameCollator = cached(
  (language) =>
    new Intl.Collator(language, { numeric: true, sensitivity: "base" }),
)

/** A date with its time, such as when an item was changed. */
export function formatDate(time: number): string {
  return dateTimeFormat().format(time)
}

/** A date without its time. */
export function formatDay(time: number): string {
  return dateFormat().format(time)
}

/** A month and day, without the year. */
export function formatMonthDay(time: number): string {
  return dayFormat().format(time)
}

/** A time before now in the given unit, such as "3 hours ago". */
export function formatTimeAgo(
  count: number,
  unit: Intl.RelativeTimeFormatUnit,
): string {
  return relativeTimeFormat().format(-count, unit)
}

/** Compares names as people sort them: ignoring case and accents, with numbers in order. */
export function compareNames(first: string, second: string): number {
  return nameCollator().compare(first, second)
}

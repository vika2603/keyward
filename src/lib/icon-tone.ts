/**
 * Whether an icon is drawn almost only in light or only in dark pixels, so that it would vanish on a
 * tile of the same tone; `null` for one with colours or with a background of its own.
 */
export type IconTone = "dark" | "light" | null

/**
 * The share of an icon's pixels that must be of one tone. Icons with a background of their own,
 * such as Google's white disc around its coloured G or Wikipedia's white square around its black
 * W, have a fifth or more of their pixels in another tone and show on any tile.
 */
const ONE_TONE_SHARE = 0.9
const LIGHT_LUMINANCE = 0.75
const DARK_LUMINANCE = 0.3
/** The least alpha, out of 255, of a pixel that counts; clearer ones are skipped. */
const MINIMUM_ALPHA = 128

/** The tone of an icon from its RGBA pixels, as a canvas reads them; mostly clear pixels are skipped. */
export function iconToneOf(pixels: ArrayLike<number>): IconTone {
  let opaque = 0
  let light = 0
  let dark = 0
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < MINIMUM_ALPHA) continue
    const luminance =
      (0.2126 * (pixels[offset] ?? 0) +
        0.7152 * (pixels[offset + 1] ?? 0) +
        0.0722 * (pixels[offset + 2] ?? 0)) /
      255
    opaque++
    if (luminance > LIGHT_LUMINANCE) light++
    else if (luminance < DARK_LUMINANCE) dark++
  }
  if (!opaque) return null
  if (light / opaque >= ONE_TONE_SHARE) return "light"
  if (dark / opaque >= ONE_TONE_SHARE) return "dark"
  return null
}

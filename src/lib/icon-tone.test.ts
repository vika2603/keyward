import { describe, expect, it } from "vitest"
import { iconToneOf, isGreyIcon } from "./icon-tone"

type Pixel = [number, number, number, number]

const WHITE: Pixel = [255, 255, 255, 255]
const BLACK: Pixel = [0, 0, 0, 255]
const CLEAR: Pixel = [0, 0, 0, 0]
const RED: Pixel = [234, 67, 53, 255]
const BLUE: Pixel = [66, 133, 244, 255]

/** An icon's pixels: each pixel repeated as many times as given. */
function icon(...parts: [Pixel, number][]): number[] {
  return parts.flatMap(([pixel, count]) =>
    Array.from({ length: count }, () => pixel).flat(),
  )
}

describe("iconToneOf", () => {
  it("finds a white or a black glyph on a clear background", () => {
    expect(iconToneOf(icon([WHITE, 120], [CLEAR, 136]))).toBe("light")
    expect(iconToneOf(icon([BLACK, 120], [CLEAR, 136]))).toBe("dark")
  })

  it("leaves an icon with a background of its own to the theme's tile", () => {
    // A white disc around a coloured letter, as Google's icon is.
    expect(
      iconToneOf(icon([WHITE, 140], [RED, 35], [BLUE, 35], [CLEAR, 46])),
    ).toBeNull()
    // A white square around a black letter, as Wikipedia's icon is.
    expect(iconToneOf(icon([WHITE, 200], [BLACK, 56]))).toBeNull()
  })

  it("has no tone for a coloured icon or one with no opaque pixels", () => {
    expect(iconToneOf(icon([RED, 100], [BLUE, 100]))).toBeNull()
    expect(iconToneOf(icon([CLEAR, 256]))).toBeNull()
  })
})

describe("isGreyIcon", () => {
  const DARK_GREY: Pixel = [36, 41, 47, 255]
  const PALE_YELLOW: Pixel = [255, 236, 150, 255]

  it("finds a glyph drawn in greys, as GitHub's black or white octocat", () => {
    expect(isGreyIcon(icon([DARK_GREY, 120], [CLEAR, 136]))).toBe(true)
    expect(isGreyIcon(icon([WHITE, 110], [BLACK, 10], [CLEAR, 136]))).toBe(true)
  })

  it("keeps the colours of a coloured icon, even a light one", () => {
    expect(isGreyIcon(icon([PALE_YELLOW, 120], [CLEAR, 136]))).toBe(false)
    expect(isGreyIcon(icon([WHITE, 140], [RED, 35], [BLUE, 35]))).toBe(false)
    expect(isGreyIcon(icon([CLEAR, 256]))).toBe(false)
  })
})

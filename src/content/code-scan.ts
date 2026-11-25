import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { eventOrigin } from "./deep-dom"

const SVG_NS = "http://www.w3.org/2000/svg"
/** QR codes on setup pages are shown at roughly this size range, and square. */
const MIN_SIZE = 40
const MAX_SIZE = 800
/** Moving across a page passes over many elements; only one the pointer stays on is read. */
const HOVER_DELAY_MS = 120
/** How far width and height may differ, as a share of the longer side, for a square picture. */
const SQUARE_TOLERANCE = 0.2

type CodeCandidate = { uri: string } | { image: string } | null

function isSquarish(width: number, height: number): boolean {
  return (
    width >= MIN_SIZE &&
    height >= MIN_SIZE &&
    width <= MAX_SIZE &&
    height <= MAX_SIZE &&
    Math.abs(width - height) <= Math.max(width, height) * SQUARE_TOLERANCE
  )
}

function loadImage(
  src: string,
  crossOrigin = false,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    if (crossOrigin) image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Image did not load"))
    image.src = src
  })
}

/** Draws a picture on white as a PNG; null when the page's picture may not be read. */
function toPng(
  source: CanvasImageSource,
  width: number,
  height: number,
): string | null {
  const scale = Math.min(1, MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext("2d")
  if (!context) return null
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL("image/png")
  } catch {
    // A picture from another site without CORS taints the canvas.
    return null
  }
}

/** An inline SVG as a standalone image, keeping the colours the page's styles give it. */
async function svgToPng(svg: SVGSVGElement): Promise<string | null> {
  const { width, height } = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", SVG_NS)
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  const originals = [svg, ...svg.querySelectorAll("*")]
  const copies = [clone, ...clone.querySelectorAll("*")]
  originals.forEach((original, index) => {
    const style = getComputedStyle(original)
    const copy = copies[index]
    copy?.setAttribute("fill", style.fill)
    copy?.setAttribute("stroke", style.stroke)
  })
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    }),
  )
  try {
    return toPng(await loadImage(url), width * 2, height * 2)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function imageToPng(image: HTMLImageElement): Promise<string | null> {
  if (!image.complete || !image.naturalWidth) return null
  const png = toPng(image, image.naturalWidth, image.naturalHeight)
  if (png) return png
  // Sites that send CORS headers allow reading the picture when it is loaded anonymously.
  const src = image.currentSrc || image.src
  if (!/^https?:/i.test(src)) return null
  try {
    const copy = await loadImage(src, true)
    return toPng(copy, copy.naturalWidth, copy.naturalHeight)
  } catch {
    return null
  }
}

/** What an element under the pointer may hold: an `otpauth:` link, or a picture to read. */
async function candidateOf(element: Element): Promise<CodeCandidate> {
  if (element instanceof HTMLAnchorElement)
    return element.protocol === "otpauth:" ? { uri: element.href } : null
  const { width, height } = element.getBoundingClientRect()
  if (!isSquarish(width, height)) return null
  const image = await pictureToPng(element)
  return image ? { image } : null
}

async function pictureToPng(element: Element): Promise<string | null> {
  if (element instanceof HTMLImageElement) return imageToPng(element)
  if (element instanceof HTMLCanvasElement)
    return toPng(element, element.width, element.height)
  if (element instanceof SVGSVGElement) return svgToPng(element)
  return null
}

/** The outermost SVG of a drawing, or the nearest link, picture or canvas. */
function targetOf(event: Event): Element | null {
  const origin = eventOrigin(event)
  if (!(origin instanceof Element)) return null
  const found = origin.closest("a[href], img, canvas, svg")
  if (!(found instanceof SVGElement)) return found
  let svg = found instanceof SVGSVGElement ? found : found.ownerSVGElement
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement
  return svg
}

/**
 * Reports what the pointer rests on while `enabled` says a vault can take an authenticator key:
 * QR codes and `otpauth:` links are offered to the background, which reads them, and leaving them
 * withdraws the offer.
 */
export function watchCodeImages(
  ctx: ContentScriptContext,
  enabled: () => boolean,
  report: (candidate: CodeCandidate) => Promise<boolean>,
): void {
  let current: Element | null = null
  let offered = false
  let timer = 0
  ctx.addEventListener(
    document,
    "mouseover",
    (event) => {
      if (!enabled()) return
      const target = targetOf(event)
      if (target === current) return
      current = target
      clearTimeout(timer)
      timer = window.setTimeout(async () => {
        const candidate = target ? await candidateOf(target) : null
        if (target !== current) return
        if (!candidate && !offered) return
        offered = await report(candidate).catch(() => false)
      }, HOVER_DELAY_MS)
    },
    { capture: true, passive: true },
  )
}

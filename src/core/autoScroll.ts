/**
 * Keep the playback cursor visible by scrolling whatever is scrolling the
 * score: the score panel on desktop, or the page itself on phones/tablets.
 *
 * Sticky panels (the controls on top, the diagram at the bottom) cover part
 * of the screen, so we only count the area between them as "visible". Mark
 * such panels with data-sticky="top" or data-sticky="bottom".
 */

const MARGIN = 24 // px of breathing room above/below the cursor
const TARGET = 0.18 // when scrolling, put the cursor this far down the visible area

let scrollingUntil = 0

/**
 * @param el        the cursor element
 * @param aheadDy   if the NEXT cursor position is on a new line of music, how
 *                  far below the cursor (px) that line starts — so we can
 *                  scroll it into view before the cursor jumps there
 * @param aheadH    height of that next line's cursor box
 */
export function keepInView(el: HTMLElement | null, aheadDy = 0, aheadH = 0): void {
  if (!el || el.hidden) return
  // A smooth scroll is already under way; don't fight it.
  if (performance.now() < scrollingUntil) return

  const scroller = scrollParent(el)
  const cursor = el.getBoundingClientRect()
  // What must be visible: the cursor, plus the next line if it's coming up.
  const top = cursor.top
  const bottom = aheadDy > 0 ? Math.max(cursor.bottom, cursor.top + aheadDy + aheadH) : cursor.bottom
  const area = visibleArea(scroller)
  if (top >= area.top + MARGIN && bottom <= area.bottom - MARGIN) return

  // If both lines fit, show them from the top; otherwise just place the cursor.
  const fits = bottom - top <= area.bottom - area.top - 2 * MARGIN
  const delta = fits && aheadDy > 0 ? top - (area.top + MARGIN) : top - (area.top + (area.bottom - area.top) * TARGET)
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'
  if (scroller) scroller.scrollBy({ top: delta, behavior })
  else window.scrollBy({ top: delta, behavior })
  scrollingUntil = performance.now() + (reduceMotion ? 0 : 450)
}

/** The nearest ancestor that actually scrolls vertically, or null for the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
  }
  return null
}

/** The part of the screen where the score can be seen, between sticky panels. */
function visibleArea(scroller: HTMLElement | null): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  if (scroller) {
    const r = scroller.getBoundingClientRect()
    top = Math.max(top, r.top)
    bottom = Math.min(bottom, r.bottom)
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-sticky]')) {
    if (getComputedStyle(panel).position !== 'sticky') continue
    const r = panel.getBoundingClientRect()
    if (panel.dataset.sticky === 'top') top = Math.max(top, r.bottom)
    else bottom = Math.min(bottom, r.top)
  }
  return { top, bottom: Math.max(bottom, top + 1) }
}

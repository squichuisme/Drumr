/**
 * Shared "light up" animation for diagram pieces, using the Web Animations
 * API. Each call restarts the animation, so rapid repeated hits (16th notes
 * on the hi-hat) each get a fresh flash, and simultaneous hits on different
 * pieces simply animate at the same time.
 */
export interface FlashOptions {
  /** 0..1 loudness of the hit — louder hits glow brighter. */
  velocity: number
  /** Accented hits get a brighter, longer, slightly bigger flash. */
  accent: boolean
}

export function flash(el: Element | null | undefined, { velocity, accent }: FlashOptions): void {
  if (!el) return
  for (const a of el.getAnimations()) a.cancel()
  const peak = accent ? 1 : 0.3 + 0.55 * velocity
  el.animate(
    [
      { opacity: peak, transform: accent ? 'scale(1.07)' : 'scale(1.02)' },
      { opacity: peak * 0.6, offset: 0.35 },
      { opacity: 0, transform: 'scale(1)' },
    ],
    { duration: accent ? 480 : 300, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
  )
}

/** The extra white-hot core layer, only shown for accents. */
export function flashHot(el: Element | null | undefined): void {
  if (!el) return
  for (const a of el.getAnimations()) a.cancel()
  el.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' })
}

/**
 * Keeps a map of named SVG elements so the diagram can find "snare" or
 * "hihat-pedal" quickly. Use as: <g ref={registry.ref('snare')}>.
 */
export function createRegistry() {
  const map = new Map<string, Element>()
  const callbacks = new Map<string, (el: Element | null) => void>()
  return {
    get: (key: string) => map.get(key),
    ref(key: string) {
      let cb = callbacks.get(key)
      if (!cb) {
        cb = (el: Element | null) => {
          if (el) map.set(key, el)
          else map.delete(key)
        }
        callbacks.set(key, cb)
      }
      return cb
    },
  }
}

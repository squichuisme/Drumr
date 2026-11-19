/**
 * A tiny publish/subscribe channel for "these drums were just hit".
 *
 * Playback (and the manual step buttons) publish a list of simultaneous hits;
 * the diagrams subscribe and flash the matching pieces. Using a bus instead of
 * React state means a flash never waits for a React re-render, so the lights
 * stay locked to the audio even at fast tempos.
 */
import type { NoteEvent } from './types'

type HitListener = (hits: NoteEvent[]) => void
type ResetListener = () => void

const hitListeners = new Set<HitListener>()
const resetListeners = new Set<ResetListener>()

export const hitBus = {
  /** Publish a group of simultaneous hits. */
  emit(hits: NoteEvent[]): void {
    if (hits.length === 0) return
    for (const l of hitListeners) l(hits)
  },
  subscribe(listener: HitListener): () => void {
    hitListeners.add(listener)
    return () => hitListeners.delete(listener)
  },
  /** Playback stopped or jumped: clear any "current hit" indicators. */
  reset(): void {
    for (const l of resetListeners) l()
  },
  onReset(listener: ResetListener): () => void {
    resetListeners.add(listener)
    return () => resetListeners.delete(listener)
  },
}

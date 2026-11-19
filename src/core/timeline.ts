/**
 * Small pure helpers for working with a parsed timeline: grouping
 * simultaneous hits and finding positions by beat. Kept free of React,
 * OSMD and Tone.js so they're easy to unit test.
 */
import type { NoteEvent, ScoreTimeline } from './types'

/** All hits that start at the same moment (e.g. hi-hat + kick on beat 1). */
export interface HitGroup {
  beat: number
  events: NoteEvent[]
}

/** Group events that share a beat. Input must be sorted by beat (parseScore guarantees this). */
export function groupByBeat(events: NoteEvent[]): HitGroup[] {
  const groups: HitGroup[] = []
  for (const e of events) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(last.beat - e.beat) < 1e-6) last.events.push(e)
    else groups.push({ beat: e.beat, events: [e] })
  }
  return groups
}

/**
 * Index of the last entry whose beat is <= `beat` (binary search), or -1 if
 * `beat` comes before the first entry. Works on any array sorted by beat.
 */
export function indexAtBeat<T extends { beat: number }>(items: readonly T[], beat: number): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].beat <= beat + 1e-6) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Hits with fromBeat < beat <= toBeat (used when stepping the cursor by hand). */
export function eventsInRange(events: readonly NoteEvent[], fromBeatExclusive: number, toBeatInclusive: number): NoteEvent[] {
  return events.filter((e) => e.beat > fromBeatExclusive + 1e-6 && e.beat <= toBeatInclusive + 1e-6)
}

/** The playback-order measure containing `beat`. */
export function measureIndexAtBeat(timeline: ScoreTimeline, beat: number): number {
  const starts = timeline.measures.map((m) => ({ beat: m.startBeat }))
  return Math.max(0, indexAtBeat(starts, beat))
}

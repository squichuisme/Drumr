/**
 * Planning a playback session: turn the parsed timeline into a flat list of
 * things to schedule on Tone.Transport, each at an exact tick.
 *
 * Everything — count-in clicks, metronome clicks, drum hits and cursor
 * moves — goes on the ONE Transport timeline. Tone.js converts ticks to
 * audio-clock seconds for all of them with the same tempo map, so the
 * cursor, the lights and the sound cannot drift apart, however long you play.
 *
 * Transport time for a session:
 *
 *   transport beat 0          lead-in (count-in)        start of music
 *   |---- click click click click ----|=== bar 5 === bar 6 === ...
 *
 *   transportBeat = scoreBeat − startBeat + leadIn
 *
 * This file has no Tone.js dependency so it can be unit tested.
 */
import { groupByBeat, indexAtBeat, measureIndexAtBeat } from '../core/timeline'
import type { NoteEvent, ScoreTimeline, Swing, TimeSignature } from '../core/types'

/** Ticks per quarter note. High resolution keeps grace notes and tuplets precise. */
export const PPQ = 960

export interface LoopRange {
  /** Score beats, start inclusive, end exclusive. */
  startBeat: number
  endBeat: number
}

export type ScheduleItem =
  | { kind: 'hits'; ticks: number; events: NoteEvent[] }
  | { kind: 'step'; ticks: number; stepIndex: number }
  | { kind: 'click'; ticks: number; accent: boolean; countIn: boolean; count?: number }
  | { kind: 'countInEnd'; ticks: number }
  | { kind: 'end'; ticks: number }

export interface SessionPlan {
  items: ScheduleItem[]
  /** Score beat that transport beat `leadInBeats` corresponds to. */
  startBeat: number
  endBeat: number
  /** Length of the count-in in beats (0 when count-in is off). */
  leadInBeats: number
  /** Transport loop points in ticks, when looping. */
  loop: { startTicks: number; endTicks: number } | null
  ppq: number
}

/**
 * How to swing: 'score' plays the swing written in the score (straight where
 * none is written); a number forces that swing ratio everywhere (0.5 = straight,
 * 2/3 = triplet swing) — handy for practising a feel on any groove.
 */
export type SwingSetting = 'score' | number

export interface PlanOptions {
  /** Where to start (ignored when a loop is set: loops start at their start). */
  startBeat: number
  loop: LoopRange | null
  countIn: boolean
  swing?: SwingSetting
  ppq?: number
}

/** How far before a start/loop point we look for grace notes that belong to its first beat. */
const GRACE_WINDOW = 0.5

/**
 * Length of one metronome click in beats. Simple meters click every notated
 * beat (quarters in 4/4, halves in 2/2); compound meters (6/8, 9/8, 12/8)
 * click every dotted quarter, the way musicians feel them.
 */
export function clickUnitBeats(ts: TimeSignature): number {
  const unit = 4 / ts.beatType
  if (ts.beatType === 8 && ts.beats % 3 === 0 && ts.beats > 3) return unit * 3
  return unit
}

/**
 * Swing: move written beats to where they are actually played.
 *
 * Only notes exactly on the "and" (halfway through a beat) move — to `ratio`
 * of the way through the beat. Downbeats stay put, and so do triplets and
 * 16ths, which jazz players don't swing in an 8th-note swing feel. A grace
 * note (flam) just before an "and" moves along with its main note. Because the
 * cursor goes through this same function, it stays locked to the sound.
 *
 *   written:  1 . . & . . 2      (& at 0.5 of the beat)
 *   swung:    1 . . . & . 2      (& at 2/3 of the beat with triplet swing)
 */
export function makeSwingWarp(timeline: ScoreTimeline, setting: SwingSetting = 'score') {
  const measureStarts = timeline.measures.map((m) => ({ beat: m.startBeat }))
  const forced: Swing | null = typeof setting === 'number' && setting > 0.5 + 1e-6 ? { ratio: setting, unit: 'eighth' } : null

  return (beat: number, isGrace = false): number => {
    const m = timeline.measures[Math.max(0, indexAtBeat(measureStarts, beat))]
    if (!m) return beat
    const swing = setting === 'score' ? m.swing : forced && { ...forced, unit: m.swing?.unit ?? forced.unit }
    if (!swing) return beat
    const pair = swing.unit === '16th' ? 0.5 : 1 // length of one long-short pair, in beats
    const pos = (beat - m.startBeat) / pair
    const within = pos - Math.floor(pos + 1e-6) // 0..1 through the pair
    const shift = (swing.ratio - 0.5) * pair
    if (Math.abs(within - 0.5) < 1e-6) return beat + shift // the off-beat note
    if (isGrace && within > 0.25 && within < 0.5) return beat + shift // a flam into the off-beat
    return beat
  }
}

export function planSession(timeline: ScoreTimeline, stepBeats: readonly number[], opts: PlanOptions): SessionPlan {
  const ppq = opts.ppq ?? PPQ
  const played = makeSwingWarp(timeline, opts.swing ?? 'score')
  const loop = opts.loop
  const start = loop ? loop.startBeat : Math.max(0, opts.startBeat)
  const end = loop ? loop.endBeat : timeline.totalBeats

  // The count-in is one full bar in the time signature of the bar we start in.
  const startMeasure = timeline.measures[measureIndexAtBeat(timeline, start)]
  const ts = startMeasure?.timeSignature ?? { beats: 4, beatType: 4 }
  const leadIn = opts.countIn ? (ts.beats * 4) / ts.beatType : 0

  const toTicks = (scoreBeat: number) => Math.round((scoreBeat - start + leadIn) * ppq)
  const inRange = (beat: number) => beat >= start - 1e-6 && beat < end - 1e-6
  const items: ScheduleItem[] = []

  // 1. Count-in clicks, filling the lead-in.
  if (leadIn > 0) {
    const unit = clickUnitBeats(ts)
    const clicks = Math.round(leadIn / unit)
    for (let k = 0; k < clicks; k++) {
      items.push({ kind: 'click', ticks: Math.round(k * unit * ppq), accent: k === 0, countIn: true, count: k + 1 })
    }
    items.push({ kind: 'countInEnd', ticks: toTicks(start) })
  }

  // 2. Drum hits, grouped so simultaneous hits share one callback (and light up together).
  for (const group of groupByBeat(timeline.events)) {
    const grace = group.events.every((e) => e.grace)
    if (inRange(group.beat)) {
      items.push({ kind: 'hits', ticks: toTicks(played(group.beat, grace)), events: group.events })
    } else if (group.beat < start && group.beat >= start - GRACE_WINDOW && grace) {
      // Grace notes (flams/drags) just before the start belong to its first beat.
      items.push({ kind: 'hits', ticks: Math.max(0, toTicks(group.beat)), events: group.events })
      // When looping, replay them just before each wrap-around too.
      if (loop) items.push({ kind: 'hits', ticks: toTicks(end - (start - group.beat)), events: group.events })
    }
  }

  // 3. Metronome clicks on every beat of every bar in range (downbeats accented).
  for (const m of timeline.measures) {
    if (m.startBeat + m.lengthBeats <= start || m.startBeat >= end) continue
    const unit = clickUnitBeats(m.timeSignature)
    for (let b = m.startBeat; b < m.startBeat + m.lengthBeats - 1e-6; b += unit) {
      if (inRange(b)) items.push({ kind: 'click', ticks: toTicks(b), accent: b === m.startBeat, countIn: false })
    }
  }

  // 4. Cursor moves. Same beats (and the same swing) → same ticks as the hits they sit on.
  stepBeats.forEach((beat, stepIndex) => {
    if (inRange(beat)) items.push({ kind: 'step', ticks: toTicks(played(beat)), stepIndex })
  })

  // 5. The end of the music (looping sessions never end).
  if (!loop) items.push({ kind: 'end', ticks: toTicks(end) })

  items.sort((a, b) => a.ticks - b.ticks)
  return {
    items,
    startBeat: start,
    endBeat: end,
    leadInBeats: leadIn,
    loop: loop ? { startTicks: toTicks(start), endTicks: toTicks(end) } : null,
    ppq,
  }
}

/** Convert a transport tick in this session back to a score beat. */
export function ticksToScoreBeat(plan: SessionPlan, ticks: number): number {
  return ticks / plan.ppq - plan.leadInBeats + plan.startBeat
}

/** Seconds from transport start at a constant tempo — used to check for drift. */
export function ticksToSeconds(ticks: number, bpm: number, ppq = PPQ): number {
  return (ticks / ppq) * (60 / bpm)
}

/**
 * Decides which drum Voice a single note plays, using the tables in
 * src/config/drumMap.ts. The parser gathers the facts about a note (its
 * instrument, staff position and notehead) and this module applies the rules.
 */
import type { DrumMapConfig, NoteheadRule, NoteheadShape, ResolutionStep } from '../config/drumMap'
import type { Voice } from './types'

/** Everything about a note that matters for picking a drum. */
export interface NoteFacts {
  /** Name of the <score-instrument> the note's <instrument id> points to. */
  instrumentName?: string
  /** General MIDI note number (already converted to 0-based). */
  midi?: number
  /** Steps above the bottom line of a five-line staff (see the diagram in drumMap.ts). */
  staffPosition: number
  notehead: NoteheadShape
  /**
   * For one-line staves only: steps above (+) or below (-) the line.
   * Undefined for normal five-line staves.
   */
  stepsFromSingleLine?: number
}

export interface Resolution {
  voice: Voice
  /** Which rule decided it, handy for debugging a drum map. */
  via: ResolutionStep
}

/** Map MusicXML <notehead> values onto the few shapes the drum map cares about. */
export function normalizeNotehead(value: string | null | undefined): NoteheadShape {
  switch ((value ?? 'normal').trim().toLowerCase()) {
    case 'x':
    case 'cross':
      return 'x'
    case 'circle-x':
    case 'circled':
      return 'circle-x'
    case 'diamond':
      return 'diamond'
    case 'triangle':
    case 'inverted triangle':
      return 'triangle'
    case 'slash':
      return 'slash'
    default:
      return 'normal'
  }
}

/** Look a notehead up in one position's rule, falling back to `any`. */
export function lookupNotehead(rule: NoteheadRule | undefined, shape: NoteheadShape): Voice | undefined {
  if (!rule) return undefined
  return rule[shape] ?? rule.any
}

/** Try each strategy in the configured order; the first one that knows the note wins. */
export function resolveVoice(facts: NoteFacts, map: DrumMapConfig): Resolution | null {
  for (const step of map.resolutionOrder) {
    const voice = tryStep(step, facts, map)
    if (voice) return { voice, via: step }
  }
  return null
}

function tryStep(step: ResolutionStep, facts: NoteFacts, map: DrumMapConfig): Voice | undefined {
  switch (step) {
    case 'instrumentName': {
      const name = facts.instrumentName
      if (!name) return undefined
      return map.instrumentNameRules.find((rule) => rule.pattern.test(name))?.voice
    }
    case 'midi':
      return facts.midi === undefined ? undefined : map.midiNotes[facts.midi]
    case 'staffPosition': {
      // One-line staff: only "on / above / below the line" matters.
      if (facts.stepsFromSingleLine !== undefined) {
        const s = facts.stepsFromSingleLine
        const zone = s === 0 ? map.singleLineStaff.onLine : s > 0 ? map.singleLineStaff.above : map.singleLineStaff.below
        return lookupNotehead(zone, facts.notehead)
      }
      // Five-line staff: the standard drum key.
      return lookupNotehead(map.fiveLineStaff[facts.staffPosition], facts.notehead)
    }
  }
}

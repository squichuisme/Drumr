/**
 * Shared types for StickTrack's score timeline.
 *
 * Time is always measured in BEATS, where one beat = one quarter note.
 * Beats are independent of tempo: changing the tempo slider only changes how
 * many seconds a beat lasts, so the parsed timeline never needs recomputing.
 */

/**
 * Every distinct drum sound StickTrack knows about. The MusicXML parser maps
 * each note to one of these (see src/config/drumMap.ts), the audio engine
 * has a synth for each, and the diagrams decide which piece lights up.
 */
export type Voice =
  | 'kick'
  | 'snare'
  | 'snareEdge' // marching snare played near the edge of the head
  | 'snareRim' // rim shot / cross-stick
  | 'stickClick' // sticks clicked together (marching)
  | 'hihatClosed'
  | 'hihatOpen'
  | 'hihatPedal' // hi-hat closed with the foot
  | 'crash'
  | 'ride'
  | 'rideBell'
  | 'tom1' // high rack tom
  | 'tom2' // low rack tom
  | 'floorTom'

export type Hand = 'R' | 'L'

/** One drum hit, ready to schedule. */
export interface NoteEvent {
  /** Onset from the start of the score (repeats unrolled), in quarter-note beats. */
  beat: number
  /** Written length in beats (drums don't sustain, but useful for display/debugging). */
  durationBeats: number
  voice: Voice
  /** Marked with an accent (>) or strong accent (^). */
  accent: boolean
  /** Ghost note (notehead in parentheses). */
  ghost: boolean
  /** Grace note (flam/drag stroke placed just before the main note). */
  grace: boolean
  /** Loudness 0..1 derived from accent/ghost/grace (see velocity in drumMap.ts). */
  velocity: number
  /** Sticking written in the score (lyric, fingering or text), if any. */
  sticking: Hand | null
  /** Index into ScoreTimeline.measures (playback order). */
  measureIndex: number
  /** Index of the written measure this note came from (0-based, score order). */
  sourceMeasureIndex: number
}

export interface TimeSignature {
  beats: number
  beatType: number
}

/** A measure as it occurs in playback order (a repeated measure appears more than once). */
export interface TimelineMeasure {
  /** Position in playback order. */
  index: number
  /** Index of the written measure in the score (0-based). */
  sourceIndex: number
  /** The printed measure number (MusicXML's number attribute). */
  number: string
  startBeat: number
  lengthBeats: number
  timeSignature: TimeSignature
}

export type DiagramMode = 'kit' | 'marching'

export interface ScoreTimeline {
  title: string
  /** Tempo in quarter notes per minute, from the score (or the default). */
  tempo: number
  /** True if the tempo came from the score rather than the default. */
  tempoFromScore: boolean
  /** All hits, sorted by beat. Simultaneous hits share the same beat value. */
  events: NoteEvent[]
  /** Measures in playback order (repeats unrolled). */
  measures: TimelineMeasure[]
  /** Number of written measures in the score. */
  sourceMeasureCount: number
  totalBeats: number
  hasSticking: boolean
  /** Which diagram suits this score best (one-line staff or snare-only → marching). */
  suggestedMode: DiagramMode
  /** Human-readable problems, e.g. notes the drum map couldn't place. */
  warnings: string[]
}

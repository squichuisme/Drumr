/**
 * ===========================================================================
 *  DRUM MAP — the one file to edit to change how notes become drum sounds.
 * ===========================================================================
 *
 * Drum notation has no "pitches". Each line or space on the staff stands for
 * a drum, and the notehead shape tells you how to hit it (an x usually means
 * a cymbal or a rim). StickTrack works out which drum a note is in up to
 * three ways, tried in the order given by `resolutionOrder`:
 *
 *   1. instrumentName: MuseScore (and most notation programs) write an
 *      <instrument id="P1-I39"/> tag on every drum note that points to a
 *      <score-instrument> named e.g. "Acoustic Snare". If the name matches
 *      one of the patterns below, that decides it.
 *
 *   2. midi: the same <score-instrument> usually has a General MIDI drum
 *      note number (36 = kick, 38 = snare, 42 = closed hi-hat, ...).
 *
 *   3. staffPosition: fall back to where the note sits on the staff plus its
 *      notehead, following the standard drum-set key below. This is what a
 *      drummer reading the page does, and it's the only option for files
 *      that don't name their instruments.
 *
 * STAFF POSITIONS are counted in steps (a line or a space) from the bottom
 * line of a five-line staff:
 *
 *        11  ─ ─   space above the 1st ledger line
 *        10  ─────  1st ledger line above        ← crash (x)
 *         9         space above the staff        ← hi-hat (x)
 *         8  ═════  top line                     ← ride (x)
 *         7         4th space                    ← high rack tom
 *         6  ═════  4th line                     ← low rack tom
 *         5         3rd space                    ← snare
 *         4  ═════  middle line
 *         3         2nd space                    ← floor tom
 *         2  ═════  2nd line
 *         1         bottom space                 ← kick
 *         0  ═════  bottom line
 *        -1         space below the staff        ← hi-hat pedal (x)
 *        -2  ─────  1st ledger line below
 *
 * Positions are measured from the clef, so the map works whether a file uses
 * a percussion clef (treble positions: bottom line = E4) or, say, a bass clef.
 */
import type { DiagramMode, Voice } from '../core/types'

/** Notehead shapes we distinguish. Anything else counts as "normal". */
export type NoteheadShape = 'normal' | 'x' | 'circle-x' | 'diamond' | 'triangle' | 'slash'

/**
 * For one staff position: which voice each notehead plays. `any` is used when
 * the notehead shape isn't listed for that position.
 */
export type NoteheadRule = Partial<Record<NoteheadShape | 'any', Voice>>

export type ResolutionStep = 'instrumentName' | 'midi' | 'staffPosition'

export interface DrumMapConfig {
  resolutionOrder: ResolutionStep[]
  instrumentNameRules: { pattern: RegExp; voice: Voice }[]
  midiNotes: Record<number, Voice>
  fiveLineStaff: Record<number, NoteheadRule>
  singleLineStaff: { onLine: NoteheadRule; above: NoteheadRule; below: NoteheadRule }
  /** Text instructions (e.g. "edge") that switch the snare zone until cancelled. */
  textModes: { edgeOn: RegExp; edgeOff: RegExp }
  /** A text, lyric or fingering counts as sticking if it matches this. */
  stickingPattern: RegExp
  velocity: { normal: number; accent: number; ghost: number; grace: number }
  /** How far before the main note a grace note (flam/drag) is played, in beats. */
  graceOffsetBeats: number
  /** Used when the score has no tempo marking. */
  defaultTempo: number
}

export const DRUM_MAP: DrumMapConfig = {
  resolutionOrder: ['instrumentName', 'midi', 'staffPosition'],

  // -------------------------------------------------------------------------
  // 1. Instrument names (case-insensitive). FIRST MATCH WINS, so the more
  //    specific patterns ("open hi-hat") must come before general ones ("hi-hat").
  // -------------------------------------------------------------------------
  instrumentNameRules: [
    { pattern: /stick\s*click|^sticks?$/i, voice: 'stickClick' },
    { pattern: /rim\s*shot|rim\s*click|side\s*stick|cross\s*stick/i, voice: 'snareRim' },
    { pattern: /snare.*edge|edge/i, voice: 'snareEdge' },
    { pattern: /snare/i, voice: 'snare' },
    { pattern: /pedal\s*hi-?\s*hat|hi-?\s*hat\s*(pedal|foot)|foot\s*hi-?\s*hat/i, voice: 'hihatPedal' },
    { pattern: /open\s*hi-?\s*hat|hi-?\s*hat\s*open/i, voice: 'hihatOpen' },
    { pattern: /hi-?\s*hat/i, voice: 'hihatClosed' },
    { pattern: /ride\s*bell|bell\s*of\s*ride/i, voice: 'rideBell' },
    { pattern: /ride/i, voice: 'ride' },
    { pattern: /crash|splash|china|chinese/i, voice: 'crash' },
    { pattern: /floor\s*tom/i, voice: 'floorTom' },
    { pattern: /low(-|\s)*mid\s*tom|low\s*tom|tom\s*2/i, voice: 'tom2' },
    { pattern: /hi(gh)?(-|\s)*mid\s*tom|hi(gh)?\s*tom|tom\s*1/i, voice: 'tom1' },
    { pattern: /kick|bass\s*drum/i, voice: 'kick' },
  ],

  // -------------------------------------------------------------------------
  // 2. General MIDI percussion note numbers (channel 10).
  //    Note: MusicXML's <midi-unpitched> counts from 1, so the parser
  //    subtracts 1 before looking a number up here.
  // -------------------------------------------------------------------------
  midiNotes: {
    31: 'stickClick', // Sticks (GM2)
    35: 'kick', // Acoustic Bass Drum
    36: 'kick', // Bass Drum 1
    37: 'snareRim', // Side Stick
    38: 'snare', // Acoustic Snare
    39: 'snareRim', // Hand Clap (closest match on a kit)
    40: 'snare', // Electric Snare
    41: 'floorTom', // Low Floor Tom
    42: 'hihatClosed', // Closed Hi-Hat
    43: 'floorTom', // High Floor Tom
    44: 'hihatPedal', // Pedal Hi-Hat
    45: 'tom2', // Low Tom
    46: 'hihatOpen', // Open Hi-Hat
    47: 'tom2', // Low-Mid Tom
    48: 'tom1', // Hi-Mid Tom
    49: 'crash', // Crash Cymbal 1
    50: 'tom1', // High Tom
    51: 'ride', // Ride Cymbal 1
    52: 'crash', // Chinese Cymbal
    53: 'rideBell', // Ride Bell
    55: 'crash', // Splash Cymbal
    57: 'crash', // Crash Cymbal 2
    59: 'ride', // Ride Cymbal 2
  },

  // -------------------------------------------------------------------------
  // 3a. Standard drum-set key for a five-line staff (see the diagram above).
  // -------------------------------------------------------------------------
  fiveLineStaff: {
    11: { any: 'crash' }, // above the ledger line: 2nd crash / china
    10: { any: 'crash' }, // x on the 1st ledger line: crash
    9: { 'circle-x': 'hihatOpen', any: 'hihatClosed' }, // x above the staff: hi-hat (circled x = open)
    8: { diamond: 'rideBell', normal: 'tom1', any: 'ride' }, // x on the top line: ride; diamond = bell
    7: { any: 'tom1' }, // 4th space: high rack tom
    6: { any: 'tom2' }, // 4th line: low rack tom
    5: { x: 'snareRim', 'circle-x': 'snareRim', diamond: 'snareEdge', any: 'snare' }, // 3rd space: snare (x = cross-stick)
    4: { any: 'tom2' }, // middle line: a 3rd (lower) rack tom on big kits — played on tom 2 here
    3: { any: 'floorTom' }, // 2nd space: floor tom
    2: { any: 'floorTom' }, // 2nd line: low floor tom — played on the floor tom here
    1: { any: 'kick' }, // bottom space: kick
    0: { any: 'kick' }, // bottom line: some keys put a 2nd kick here
    [-1]: { any: 'hihatPedal' }, // x below the staff: hi-hat pedal
    [-2]: { any: 'hihatPedal' }, // x on the ledger line below: also hi-hat pedal
  },

  // -------------------------------------------------------------------------
  // 3b. One-line staff (marching snare, concert snare). There's only one line,
  //     so we only ask whether a note is on it, above it or below it. The
  //     parser treats the most common position of normal noteheads as "the
  //     line", which works no matter which pitch the exporting program used.
  // -------------------------------------------------------------------------
  singleLineStaff: {
    onLine: { diamond: 'snareEdge', x: 'snareRim', 'circle-x': 'snareRim', any: 'snare' },
    above: { any: 'stickClick' },
    below: { x: 'stickClick', any: 'snare' },
  },

  textModes: {
    // "edge" written above the staff: snare notes play the edge zone ...
    edgeOn: /^\s*(edge|edges|on\s+edge)\s*\.?\s*$/i,
    // ... until "center", "norm." or "ord." switches back.
    edgeOff: /^\s*(center|centre|middle|norm\.?|normal|ord\.?|ordinario)\s*$/i,
  },

  // R, L, r, l — optionally with a lowercase grace letter in front ("lR" = flam).
  stickingPattern: /^\s*[rl]?[RLrl]\s*$/,

  velocity: { normal: 0.72, accent: 1.0, ghost: 0.32, grace: 0.42 },

  graceOffsetBeats: 0.06,

  defaultTempo: 100,
}

// ---------------------------------------------------------------------------
// Diagram mapping: which piece of the instrument diagram lights up per voice.
// ---------------------------------------------------------------------------

/** Pieces on the drum-kit diagram. */
export type KitPiece = 'kick' | 'snare' | 'hihat' | 'tom1' | 'tom2' | 'floorTom' | 'crash' | 'ride'

export const KIT_PIECE_FOR_VOICE: Record<Voice, KitPiece> = {
  kick: 'kick',
  snare: 'snare',
  snareEdge: 'snare',
  snareRim: 'snare',
  stickClick: 'snare',
  hihatClosed: 'hihat',
  hihatOpen: 'hihat',
  hihatPedal: 'hihat',
  crash: 'crash',
  ride: 'ride',
  rideBell: 'ride',
  tom1: 'tom1',
  tom2: 'tom2',
  floorTom: 'floorTom',
}

/** Zones on the marching-snare diagram. Voices not listed don't light anything there. */
export type MarchingZone = 'center' | 'edge' | 'rim' | 'click'

export const MARCHING_ZONE_FOR_VOICE: Partial<Record<Voice, MarchingZone>> = {
  snare: 'center',
  snareEdge: 'edge',
  snareRim: 'rim',
  stickClick: 'click',
}

/** Voices that belong to a snare drum; a score using only these suggests the marching diagram. */
export const SNARE_FAMILY: ReadonlySet<Voice> = new Set(['snare', 'snareEdge', 'snareRim', 'stickClick'])

/** Friendly names for the UI. */
export const VOICE_LABELS: Record<Voice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  snareEdge: 'Snare (edge)',
  snareRim: 'Rim shot',
  stickClick: 'Stick click',
  hihatClosed: 'Hi-hat',
  hihatOpen: 'Open hi-hat',
  hihatPedal: 'Hi-hat pedal',
  crash: 'Crash',
  ride: 'Ride',
  rideBell: 'Ride bell',
  tom1: 'High tom',
  tom2: 'Low tom',
  floorTom: 'Floor tom',
}

export const DEFAULT_MODE: DiagramMode = 'kit'

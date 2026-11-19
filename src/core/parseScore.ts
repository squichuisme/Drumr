/**
 * MusicXML → timed drum events.
 *
 * This is the heart of StickTrack. Given a MusicXML string it produces a
 * ScoreTimeline: every drum hit with its time in beats, which drum it is,
 * whether it's accented, and its sticking. Playback, the cursor and the
 * diagram lights all read from this one timeline.
 *
 * How the parse works:
 *   1. Read <part-list> to learn each part's instruments (name + MIDI number).
 *   2. Walk every measure of every drum part in document order, keeping a
 *      "time cursor" in divisions (MusicXML's own time unit). <backup> and
 *      <forward> move it; each <note> starts at the cursor (or with the
 *      previous note, if it's a <chord/> note) and moves it forward.
 *   3. Map each note to a drum Voice using src/config/drumMap.ts.
 *   4. Unroll repeats (src/core/repeats.ts), place each measure on the
 *      timeline, and emit one NoteEvent per hit.
 */
import { DRUM_MAP, SNARE_FAMILY, type DrumMapConfig, type NoteheadShape } from '../config/drumMap'
import { normalizeNotehead, resolveVoice, type NoteFacts } from './drumMapping'
import { unrollRepeats, type RepeatMarks } from './repeats'
import type { Hand, NoteEvent, ScoreTimeline, Swing, TimeSignature, TimelineMeasure, Voice } from './types'

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

interface Clef {
  sign: string
  line: number
  octaveChange: number
}

/** A note as written, before it is placed on the unrolled timeline. */
interface WrittenNote {
  /** Onset from the start of its measure, in beats. */
  offsetBeats: number
  durationBeats: number
  /** Mapping inputs. */
  facts: NoteFacts
  /** Identifies the staff this note is on (for one-line staff analysis). */
  staffKey: string
  singleLine: boolean
  accent: boolean
  ghost: boolean
  grace: boolean
  /** For grace notes: how many grace "slots" before the main note (1 = right before). */
  graceSlotsBefore: number
  /** True if this note only continues a tied note (so it must not be struck again). */
  tiedContinuation: boolean
  /** For single-note tremolos (rolls/diddles): time between strokes in beats, else 0. */
  tremoloStrokeBeats: number
  sticking: Hand | null
  /** "edge" text was in force when this note was written. */
  edgeMode: boolean
  /** Explicit open (o) or closed (+) marking, used for hi-hats. */
  openMark: boolean | null
  voice?: Voice
}

interface WrittenMeasure {
  number: string
  lengthBeats: number
  timeSignature: TimeSignature
  swing: Swing | null
  repeat: RepeatMarks
  notes: WrittenNote[]
}

/** State that carries over from one measure to the next within a part. */
interface PartState {
  divisions: number
  time: TimeSignature
  clefs: Map<string, Clef>
  staffLines: Map<string, number>
  edgeMode: boolean
  /** Swing feel in force (null = straight). A marking applies from its measure onward. */
  swing: Swing | null
  currentEnding: number[] | null
}

// ---------------------------------------------------------------------------
// Small DOM helpers (MusicXML is plain XML, so we only need a few)
// ---------------------------------------------------------------------------

function kids(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((c) => !name || c.localName === name)
}
function kid(el: Element, name: string): Element | undefined {
  return kids(el, name)[0]
}
function kidText(el: Element, name: string): string | undefined {
  return kid(el, name)?.textContent?.trim() ?? undefined
}
/** All descendants matching a chain of child names, e.g. path(note, 'notations', 'articulations'). */
function path(el: Element, ...names: string[]): Element[] {
  let level = [el]
  for (const n of names) level = level.flatMap((e) => kids(e, n))
  return level
}

// ---------------------------------------------------------------------------
// Pitch → staff position
// ---------------------------------------------------------------------------

const STEP_NAMES = 'CDEFGAB'

/** Diatonic step number: C0 = 0, D0 = 1, ... so each line or space is one step. */
function diatonic(step: string, octave: number): number {
  return octave * 7 + STEP_NAMES.indexOf(step.toUpperCase())
}

/**
 * The diatonic step of a clef's BOTTOM staff line. Staff position is then just
 * (note step − bottom line step), which is how the drum key is defined.
 */
function bottomLineStep(clef: Clef): number {
  const lineOffset = 2 * (clef.line - 1) // two steps (line + space) per staff line
  const octave = 7 * clef.octaveChange
  switch (clef.sign) {
    case 'G':
      return diatonic('G', 4) - lineOffset + octave // treble: G4 sits on the clef's line
    case 'F':
      return diatonic('F', 3) - lineOffset + octave // bass: F3 sits on the clef's line
    case 'C':
      return diatonic('C', 4) - lineOffset + octave // alto/tenor: middle C on the clef's line
    default:
      // Percussion (and TAB/none) clefs: MuseScore, Finale, Sibelius and
      // Dorico all write drum positions as if in treble clef (bottom line E4).
      return diatonic('E', 4)
  }
}

const DEFAULT_CLEF: Clef = { sign: 'percussion', line: 2, octaveChange: 0 }
const MIDDLE_LINE = 4

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseScore(xml: string, map: DrumMapConfig = DRUM_MAP): ScoreTimeline {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Invalid XML')
  const root = doc.documentElement
  if (root.localName !== 'score-partwise') throw new Error('Only partwise MusicXML is supported')

  const instruments = readInstruments(root)
  const warnings: string[] = []

  // Only drum parts: a part counts if it has unpitched notes or a percussion clef.
  const parts = kids(root, 'part').filter(
    (p) => p.getElementsByTagName('unpitched').length > 0 || hasPercussionClef(p),
  )
  if (parts.length === 0) {
    return emptyTimeline(root, map, ['No drum (percussion) part found in this score.'])
  }

  // --- 2. Walk the parts measure by measure --------------------------------
  let tempo: number | null = null
  const measures: WrittenMeasure[] = []
  let anySingleLine = false

  parts.forEach((part, partIndex) => {
    const partId = part.getAttribute('id') ?? `P${partIndex + 1}`
    const state: PartState = {
      divisions: 1,
      time: { beats: 4, beatType: 4 },
      clefs: new Map(),
      staffLines: new Map(),
      edgeMode: false,
      swing: null,
      currentEnding: null,
    }
    kids(part, 'measure').forEach((measureEl, mi) => {
      const parsed = parseMeasure(measureEl, partId, state, instruments, map)
      if (tempo === null && parsed.tempo !== null) tempo = parsed.tempo
      if (parsed.usesSingleLine) anySingleLine = true
      // The first drum part defines measure lengths and repeats; later parts add notes.
      if (partIndex === 0) measures[mi] = parsed.measure
      else if (measures[mi]) measures[mi].notes.push(...parsed.measure.notes)
    })
  })

  // --- 3. Map every note to a drum voice -------------------------------------
  assignVoices(measures, map, warnings)

  // --- 4. Unroll repeats and build the timeline ------------------------------
  const order = unrollRepeats(measures.map((m) => m.repeat))
  const timelineMeasures: TimelineMeasure[] = []
  const events: NoteEvent[] = []
  let beat = 0
  order.forEach((sourceIndex, index) => {
    const m = measures[sourceIndex]
    timelineMeasures.push({
      index,
      sourceIndex,
      number: m.number,
      startBeat: beat,
      lengthBeats: m.lengthBeats,
      timeSignature: m.timeSignature,
      swing: m.swing,
    })
    for (const note of m.notes) events.push(...noteToEvents(note, beat, index, sourceIndex, map))
    beat += m.lengthBeats
  })

  // Sort by time; JavaScript's sort is stable so chord order is kept.
  events.sort((a, b) => a.beat - b.beat)

  const hasSticking = events.some((e) => e.sticking !== null)
  const snareOnly = events.length > 0 && events.every((e) => SNARE_FAMILY.has(e.voice))

  return {
    title: readTitle(root),
    tempo: tempo ?? map.defaultTempo,
    tempoFromScore: tempo !== null,
    events,
    measures: timelineMeasures,
    sourceMeasureCount: measures.length,
    totalBeats: round(beat),
    hasSticking,
    suggestedMode: anySingleLine || snareOnly ? 'marching' : 'kit',
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Step 1: instruments from <part-list>
// ---------------------------------------------------------------------------

interface InstrumentInfo {
  name?: string
  midi?: number
}

function readInstruments(root: Element): Map<string, InstrumentInfo> {
  const result = new Map<string, InstrumentInfo>()
  for (const scorePart of root.getElementsByTagName('score-part')) {
    for (const si of kids(scorePart, 'score-instrument')) {
      const id = si.getAttribute('id')
      if (id) result.set(id, { name: kidText(si, 'instrument-name') })
    }
    for (const mi of kids(scorePart, 'midi-instrument')) {
      const id = mi.getAttribute('id')
      const unpitched = kidText(mi, 'midi-unpitched')
      if (!id || !unpitched) continue
      // MusicXML numbers MIDI notes 1–128, General MIDI uses 0–127.
      const info = result.get(id) ?? {}
      info.midi = Number(unpitched) - 1
      result.set(id, info)
    }
  }
  return result
}

function hasPercussionClef(part: Element): boolean {
  return Array.from(part.getElementsByTagName('clef')).some((c) => kidText(c, 'sign') === 'percussion')
}

// ---------------------------------------------------------------------------
// Step 2: one measure
// ---------------------------------------------------------------------------

function parseMeasure(
  measureEl: Element,
  partId: string,
  state: PartState,
  instruments: Map<string, InstrumentInfo>,
  map: DrumMapConfig,
): { measure: WrittenMeasure; tempo: number | null; usesSingleLine: boolean } {
  const notes: WrittenNote[] = []
  const repeat: RepeatMarks = { forward: false, backward: false, times: 2, endings: null }
  let tempo: number | null = null
  let usesSingleLine = false

  // Time cursor, in divisions. MusicXML writes voices one after another and
  // uses <backup> to rewind, so we track where "now" is as we read.
  let pos = 0
  let maxPos = 0
  let lastOnset = 0
  let pendingSticking: Hand | null = null
  let endingStopsHere = false
  // Grace notes waiting for their main note, per voice, grouped by chord.
  const pendingGraces = new Map<string, WrittenNote[][]>()

  for (const el of kids(measureEl)) {
    switch (el.localName) {
      case 'attributes':
        readAttributes(el, state)
        break

      case 'direction': {
        // An explicit MusicXML swing setting wins over style text like "Swing".
        const explicitSwing = readSwing(kid(el, 'sound'))
        if (explicitSwing !== undefined) state.swing = explicitSwing
        for (const words of path(el, 'direction-type', 'words')) {
          const text = words.textContent ?? ''
          if (map.textModes.edgeOn.test(text)) state.edgeMode = true
          else if (map.textModes.edgeOff.test(text)) state.edgeMode = false
          else if (map.stickingPattern.test(text)) pendingSticking = toHand(text)
          else if (explicitSwing === undefined && map.textModes.swingOn.test(text))
            state.swing = { ratio: map.swingRatio, unit: 'eighth' }
          else if (explicitSwing === undefined && map.textModes.swingOff.test(text)) state.swing = null
        }
        tempo ??= readTempo(el)
        break
      }

      case 'sound': {
        tempo ??= numberAttr(el, 'tempo')
        const swing = readSwing(el)
        if (swing !== undefined) state.swing = swing
        break
      }

      case 'backup':
        pos -= Number(kidText(el, 'duration') ?? 0)
        break

      case 'forward':
        pos += Number(kidText(el, 'duration') ?? 0)
        maxPos = Math.max(maxPos, pos)
        break

      case 'barline': {
        const rep = kid(el, 'repeat')
        if (rep?.getAttribute('direction') === 'forward') repeat.forward = true
        if (rep?.getAttribute('direction') === 'backward') {
          repeat.backward = true
          repeat.times = numberAttr(rep, 'times') ?? 2
        }
        const ending = kid(el, 'ending')
        if (ending) {
          const type = ending.getAttribute('type')
          if (type === 'start') state.currentEnding = parseEndingNumbers(ending.getAttribute('number'))
          if (type === 'stop' || type === 'discontinue') endingStopsHere = true
        }
        break
      }

      case 'note': {
        const isChord = !!kid(el, 'chord')
        const isGrace = !!kid(el, 'grace')
        const isRest = !!kid(el, 'rest')
        const duration = Number(kidText(el, 'duration') ?? 0)

        // Where does this note start? Chord notes share the previous onset;
        // grace notes take no time of their own.
        let onset: number
        if (isChord) {
          onset = lastOnset
        } else {
          onset = pos
          lastOnset = pos
          if (!isGrace) pos += duration
        }
        maxPos = Math.max(maxPos, pos)
        if (isRest) break

        const staff = kidText(el, 'staff') ?? '1'
        const staffKey = `${partId}/${staff}`
        const singleLine = (state.staffLines.get(staff) ?? 5) === 1
        if (singleLine) usesSingleLine = true

        const note = readNote(el, {
          offsetBeats: onset / state.divisions,
          durationBeats: duration / state.divisions,
          clef: state.clefs.get(staff) ?? DEFAULT_CLEF,
          staffKey,
          singleLine,
          instruments,
          isGrace,
          edgeMode: state.edgeMode,
          map,
        })

        // Text sticking (a <words> direction) applies to the next note struck.
        if (!note.sticking && pendingSticking && !isGrace) note.sticking = pendingSticking
        if (!isGrace) pendingSticking = null

        // Grace notes are placed just before the next main note in the same voice.
        const voiceNo = kidText(el, 'voice') ?? '1'
        const graces = pendingGraces.get(voiceNo) ?? []
        if (isGrace) {
          if (isChord && graces.length > 0) graces[graces.length - 1].push(note)
          else graces.push([note])
          pendingGraces.set(voiceNo, graces)
        } else if (!isChord && graces.length > 0) {
          graces.forEach((group, k) => group.forEach((g) => (g.graceSlotsBefore = graces.length - k)))
          pendingGraces.delete(voiceNo)
        }
        notes.push(note)
        break
      }
    }
  }

  repeat.endings = state.currentEnding
  if (endingStopsHere) state.currentEnding = null

  // Measure length: a pickup (implicit) measure is as long as its notes;
  // otherwise use the time signature (or the notes, if they overflow it).
  const nominal = (state.time.beats * 4) / state.time.beatType
  const actual = maxPos / state.divisions
  const lengthBeats = measureEl.getAttribute('implicit') === 'yes' && actual > 0 ? actual : Math.max(nominal, actual)

  return {
    measure: {
      number: measureEl.getAttribute('number') ?? '',
      lengthBeats: round(lengthBeats),
      timeSignature: { ...state.time },
      swing: state.swing,
      repeat,
      notes,
    },
    tempo,
    usesSingleLine,
  }
}

function readAttributes(el: Element, state: PartState): void {
  const divisions = kidText(el, 'divisions')
  if (divisions) state.divisions = Number(divisions)

  const time = kid(el, 'time')
  if (time && kid(time, 'beats')) {
    // "3+2" style compound beats are summed.
    const beats = (kidText(time, 'beats') ?? '4').split('+').reduce((s, b) => s + Number(b), 0)
    state.time = { beats, beatType: Number(kidText(time, 'beat-type') ?? 4) }
  }

  for (const clef of kids(el, 'clef')) {
    state.clefs.set(clef.getAttribute('number') ?? '1', {
      sign: kidText(clef, 'sign') ?? 'percussion',
      line: Number(kidText(clef, 'line') ?? 2),
      octaveChange: Number(kidText(clef, 'clef-octave-change') ?? 0),
    })
  }

  for (const details of kids(el, 'staff-details')) {
    const lines = kidText(details, 'staff-lines')
    if (lines) state.staffLines.set(details.getAttribute('number') ?? '1', Number(lines))
  }
}

interface ReadNoteContext {
  offsetBeats: number
  durationBeats: number
  clef: Clef
  staffKey: string
  singleLine: boolean
  instruments: Map<string, InstrumentInfo>
  isGrace: boolean
  edgeMode: boolean
  map: DrumMapConfig
}

function readNote(el: Element, ctx: ReadNoteContext): WrittenNote {
  // --- Which instrument? ---------------------------------------------------
  const instrumentId = kid(el, 'instrument')?.getAttribute('id')
  const instrument = instrumentId ? ctx.instruments.get(instrumentId) : undefined

  // --- Where on the staff? -------------------------------------------------
  // Drum notes use <unpitched><display-step/><display-octave/>; some older
  // exporters write a normal <pitch> instead, which we read the same way.
  const unpitched = kid(el, 'unpitched')
  const pitch = kid(el, 'pitch')
  let staffPosition = MIDDLE_LINE // MusicXML: unpitched with no display step sits on the middle line
  if (unpitched && kid(unpitched, 'display-step')) {
    staffPosition =
      diatonic(kidText(unpitched, 'display-step')!, Number(kidText(unpitched, 'display-octave') ?? 4)) -
      bottomLineStep(ctx.clef)
  } else if (pitch) {
    staffPosition = diatonic(kidText(pitch, 'step') ?? 'B', Number(kidText(pitch, 'octave') ?? 4)) - bottomLineStep(ctx.clef)
  }

  // --- Notehead shape (x = cymbal/rim, parentheses = ghost note) ----------
  const noteheadEl = kid(el, 'notehead')
  const notehead: NoteheadShape = normalizeNotehead(noteheadEl?.textContent)
  const ghost = noteheadEl?.getAttribute('parentheses') === 'yes'

  // --- Articulations, ties, tremolos, technical marks ---------------------
  const articulations = path(el, 'notations', 'articulations').flatMap((a) => kids(a))
  const accent = articulations.some((a) => a.localName === 'accent' || a.localName === 'strong-accent')

  const tieTypes = [...kids(el, 'tie'), ...path(el, 'notations', 'tied')].map((t) => t.getAttribute('type'))
  const tiedContinuation = tieTypes.includes('stop')

  let tremoloStrokeBeats = 0
  const tremolo = path(el, 'notations', 'ornaments', 'tremolo')[0]
  if (tremolo) {
    const type = tremolo.getAttribute('type') ?? 'single'
    const marks = Number(tremolo.textContent?.trim() || 3)
    // Each slash halves the stroke length: 1 slash = 8ths, 2 = 16ths, 3 = 32nds.
    if (type === 'single') tremoloStrokeBeats = 1 / 2 ** marks
    if (type === 'unmeasured') tremoloStrokeBeats = 1 / 8 // buzz roll: play as 32nds
  }

  const technical = path(el, 'notations', 'technical').flatMap((t) => kids(t))
  let openMark: boolean | null = null
  if (technical.some((t) => t.localName === 'open' || t.localName === 'open-string')) openMark = true
  if (technical.some((t) => t.localName === 'stopped')) openMark = false

  // --- Sticking: fingering first, then a lyric that looks like R/L --------
  let sticking: Hand | null = null
  const fingering = technical.find((t) => t.localName === 'fingering')?.textContent ?? ''
  const lyric = path(el, 'lyric', 'text')[0]?.textContent ?? ''
  if (ctx.map.stickingPattern.test(fingering)) sticking = toHand(fingering)
  else if (ctx.map.stickingPattern.test(lyric)) sticking = toHand(lyric)

  return {
    offsetBeats: ctx.offsetBeats,
    durationBeats: ctx.durationBeats,
    facts: { instrumentName: instrument?.name, midi: instrument?.midi, staffPosition, notehead },
    staffKey: ctx.staffKey,
    singleLine: ctx.singleLine,
    accent,
    ghost,
    grace: ctx.isGrace,
    graceSlotsBefore: 0,
    tiedContinuation,
    tremoloStrokeBeats,
    sticking,
    edgeMode: ctx.edgeMode,
    openMark,
  }
}

/** "R", "l", "lR" (flam: grace l, main R) → the main hand. */
function toHand(text: string): Hand {
  const t = text.trim()
  return t[t.length - 1].toUpperCase() as Hand
}

function parseEndingNumbers(value: string | null): number[] {
  const nums = (value ?? '1')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
  return nums.length ? nums : [1]
}

/** Tempo from a <direction>: prefer <sound tempo>, else convert a metronome mark to quarter-note BPM. */
function readTempo(direction: Element): number | null {
  const sound = kid(direction, 'sound')
  const soundTempo = sound ? numberAttr(sound, 'tempo') : null
  if (soundTempo) return soundTempo

  const metronome = path(direction, 'direction-type', 'metronome')[0]
  const perMinute = metronome ? Number(kidText(metronome, 'per-minute')) : NaN
  if (!metronome || !Number.isFinite(perMinute) || perMinute <= 0) return null
  const unitInQuarters: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }
  let unit = unitInQuarters[kidText(metronome, 'beat-unit') ?? 'quarter'] ?? 1
  if (kid(metronome, 'beat-unit-dot')) unit *= 1.5
  return round(perMinute * unit)
}

/**
 * MusicXML 4 playback swing: <sound><swing><first>2</first><second>1</second></swing></sound>
 * means each 8th-note pair is played in a 2:1 ratio (triplet swing);
 * <swing><straight/></swing> switches back to straight 8ths.
 * Returns undefined when the element says nothing about swing.
 */
function readSwing(sound: Element | undefined): Swing | null | undefined {
  const swing = sound ? kid(sound, 'swing') : undefined
  if (!swing) return undefined
  if (kid(swing, 'straight')) return null
  const first = Number(kidText(swing, 'first'))
  const second = Number(kidText(swing, 'second'))
  if (!(first > 0 && second > 0)) return null
  const ratio = first / (first + second)
  if (Math.abs(ratio - 0.5) < 1e-6) return null
  return { ratio, unit: kidText(swing, 'swing-type') === '16th' ? '16th' : 'eighth' }
}

function numberAttr(el: Element, name: string): number | null {
  const v = el.getAttribute(name)
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------------------
// Step 3: voices
// ---------------------------------------------------------------------------

function assignVoices(measures: WrittenMeasure[], map: DrumMapConfig, warnings: string[]): void {
  const allNotes = measures.flatMap((m) => m.notes)

  // One-line staves: find "the line" as the most common position of normal
  // noteheads on that staff, then describe every note relative to it.
  const lineByStaff = new Map<string, number>()
  const counts = new Map<string, Map<number, number>>()
  for (const n of allNotes) {
    if (!n.singleLine) continue
    const c = counts.get(n.staffKey) ?? new Map<number, number>()
    const weight = n.facts.notehead === 'normal' ? 10 : 1 // prefer normal heads, but count all
    c.set(n.facts.staffPosition, (c.get(n.facts.staffPosition) ?? 0) + weight)
    counts.set(n.staffKey, c)
  }
  for (const [staffKey, c] of counts) {
    const [line] = [...c.entries()].sort((a, b) => b[1] - a[1])[0]
    lineByStaff.set(staffKey, line)
  }

  const unmapped = new Map<string, number>()
  for (const n of allNotes) {
    if (n.singleLine) n.facts.stepsFromSingleLine = n.facts.staffPosition - (lineByStaff.get(n.staffKey) ?? 0)
    const resolution = resolveVoice(n.facts, map)
    if (!resolution) {
      const f = n.facts
      const label = `staff position ${f.staffPosition}, ${f.notehead} notehead${f.instrumentName ? `, instrument "${f.instrumentName}"` : ''}`
      unmapped.set(label, (unmapped.get(label) ?? 0) + 1)
      continue
    }
    n.voice = applyModifiers(resolution.voice, n)
  }
  for (const [label, count] of unmapped) {
    warnings.push(`${count} note${count > 1 ? 's' : ''} (${label}) didn't match the drum map and will be silent. Add a rule in src/config/drumMap.ts.`)
  }
}

/** Playing-technique marks that change the sound of an already-identified drum. */
function applyModifiers(voice: Voice, n: WrittenNote): Voice {
  if (voice === 'snare' && n.edgeMode) return 'snareEdge' // "edge" text in force
  if (voice === 'hihatClosed' && n.openMark === true) return 'hihatOpen' // "o" over a hi-hat
  if (voice === 'hihatOpen' && n.openMark === false) return 'hihatClosed' // "+" over a hi-hat
  return voice
}

// ---------------------------------------------------------------------------
// Step 4: events
// ---------------------------------------------------------------------------

function noteToEvents(
  n: WrittenNote,
  measureStart: number,
  measureIndex: number,
  sourceMeasureIndex: number,
  map: DrumMapConfig,
): NoteEvent[] {
  // Unmapped notes and the second half of a tie make no sound.
  if (!n.voice || n.tiedContinuation) return []

  const velocity = n.grace
    ? map.velocity.grace
    : n.ghost
      ? map.velocity.ghost
      : n.accent
        ? map.velocity.accent
        : map.velocity.normal

  const start = measureStart + n.offsetBeats - n.graceSlotsBefore * map.graceOffsetBeats
  const base: NoteEvent = {
    beat: round(start),
    durationBeats: round(n.durationBeats),
    voice: n.voice,
    accent: n.accent,
    ghost: n.ghost,
    grace: n.grace,
    velocity,
    sticking: n.sticking,
    measureIndex,
    sourceMeasureIndex,
  }
  if (!n.tremoloStrokeBeats || n.tremoloStrokeBeats >= n.durationBeats) return [base]

  // Single-note tremolo: repeat the stroke across the note's length. Only the
  // first stroke keeps the accent and written sticking.
  const strokes = Math.max(1, Math.round(n.durationBeats / n.tremoloStrokeBeats))
  return Array.from({ length: strokes }, (_, k) =>
    k === 0
      ? { ...base, durationBeats: round(n.tremoloStrokeBeats) }
      : {
          ...base,
          beat: round(start + k * n.tremoloStrokeBeats),
          durationBeats: round(n.tremoloStrokeBeats),
          accent: false,
          velocity: n.ghost ? map.velocity.ghost : map.velocity.normal,
          sticking: null,
        },
  )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Round to 6 decimals so simultaneous hits (e.g. inside triplets) get identical beat values. */
function round(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

function readTitle(root: Element): string {
  const work = kid(root, 'work')
  const title =
    (work && kidText(work, 'work-title')) ||
    kidText(root, 'movement-title') ||
    Array.from(root.getElementsByTagName('credit-words'))[0]?.textContent?.trim()
  return title || 'Untitled score'
}

function emptyTimeline(root: Element, map: DrumMapConfig, warnings: string[]): ScoreTimeline {
  return {
    title: readTitle(root),
    tempo: map.defaultTempo,
    tempoFromScore: false,
    events: [],
    measures: [],
    sourceMeasureCount: 0,
    totalBeats: 0,
    hasSticking: false,
    suggestedMode: 'kit',
    warnings,
  }
}

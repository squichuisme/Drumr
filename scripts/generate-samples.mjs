#!/usr/bin/env node
/**
 * Generates StickTrack's sample scores as MusicXML files in src/samples/.
 *
 * The output deliberately imitates what MuseScore 4 writes when you export a
 * drum part, so the app's parser is exercised on realistic input:
 *   - every drum sound is a <score-instrument> with a <midi-instrument>
 *     whose <midi-unpitched> is the General MIDI note number + 1
 *     (MusicXML counts MIDI notes from 1, not 0),
 *   - notes use <unpitched> with <display-step>/<display-octave> for their
 *     position on the staff, an <instrument id="..."/> back-reference,
 *     and a <notehead> for cymbals (x, circle-x),
 *   - cymbals and hands are written in voice 1 (stems up) and feet in
 *     voice 2 (stems down), separated by <backup>,
 *   - swing is marked the MusicXML 4 way: <sound><swing> plus "Swing" text.
 *
 * Run with:  node scripts/generate-samples.mjs   (or npm run samples)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'samples')

// ---------------------------------------------------------------------------
// Instrument palettes
// ---------------------------------------------------------------------------

/** Drum set, using MuseScore's default drumset names, MIDI notes and staff positions. */
const KIT = {
  kick: { name: 'Bass Drum 1', midi: 36, step: 'F', octave: 4 },
  snare: { name: 'Acoustic Snare', midi: 38, step: 'C', octave: 5 },
  hh: { name: 'Closed Hi-Hat', midi: 42, step: 'G', octave: 5, head: 'x' },
  ohh: { name: 'Open Hi-Hat', midi: 46, step: 'G', octave: 5, head: 'circle-x' },
  pedal: { name: 'Pedal Hi-Hat', midi: 44, step: 'D', octave: 4, head: 'x' },
  crash: { name: 'Crash Cymbal 1', midi: 49, step: 'A', octave: 5, head: 'x' },
  ride: { name: 'Ride Cymbal 1', midi: 51, step: 'F', octave: 5, head: 'x' },
  tom1: { name: 'Hi-Mid Tom', midi: 48, step: 'E', octave: 5 },
  tom2: { name: 'Low-Mid Tom', midi: 47, step: 'D', octave: 5 },
  floor: { name: 'High Floor Tom', midi: 43, step: 'A', octave: 4 },
}

/**
 * Marching snare on a one-line staff. OSMD draws a single-line percussion
 * staff's line where a five-line staff's bottom line (E4) would be, so drum
 * strokes are written on E4 and stick clicks a space above, on G4. (The app's
 * parser doesn't depend on these exact pitches: on a one-line staff it judges
 * "on the line" vs "above the line" relative to the most common note position.)
 */
const MARCHING = {
  sn: { name: 'Snare', midi: 38, step: 'E', octave: 4 },
  edge: { name: 'Snare Edge', midi: 40, step: 'E', octave: 4, head: 'diamond' },
  rim: { name: 'Rim Shot', midi: 37, step: 'E', octave: 4, head: 'x' },
  click: { name: 'Stick Click', midi: 31, step: 'G', octave: 4, head: 'x' },
}

// ---------------------------------------------------------------------------
// A tiny pattern language so the grooves below stay readable.
//
//   "2:hh+snare!@R"  =  an 8th note (2 sixteenths) playing hi-hat and an
//                       accented (!) snare together, sticking R (@R)
//   "4:kick~"        =  a quarter-note ghost/feathered (~) kick, written in parentheses
//   "T:snare"        =  one note of an 8th-note triplet (three per beat)
//   "4:r"            =  a quarter rest
// Durations are counted in 16th notes (2 = 8th, 4 = quarter …), or T.
// ---------------------------------------------------------------------------

/** Note type and dots for a length in 16ths. */
const TYPES = {
  1: ['16th', 0],
  2: ['eighth', 0],
  3: ['eighth', 1],
  4: ['quarter', 0],
  6: ['quarter', 1],
  8: ['half', 0],
  12: ['half', 1],
  16: ['whole', 0],
}

function seq(pattern) {
  return pattern
    .trim()
    .split(/\s+/)
    .map((token) => {
      const m = token.match(/^(\d+|T):([a-z0-9!~+]+)(?:@([RL]))?$/)
      if (!m) throw new Error(`Bad token "${token}"`)
      const triplet = m[1] === 'T'
      const sixteenths = triplet ? 4 / 3 : Number(m[1])
      if (!triplet && !TYPES[sixteenths]) throw new Error(`Unsupported duration ${m[1]} in "${token}"`)
      const keys =
        m[2] === 'r'
          ? null
          : m[2].split('+').map((part) => {
              const k = part.match(/^([a-z0-9]+)([!~]*)$/)
              if (!k) throw new Error(`Bad instrument "${part}" in "${token}"`)
              return { key: k[1], accent: k[2].includes('!'), ghost: k[2].includes('~') }
            })
      return { sixteenths, triplet, keys, sticking: m[3] ?? null }
    })
}

/** Repeat a pattern string n times. */
const rep = (pattern, n) => Array(n).fill(pattern).join(' ')

// ---------------------------------------------------------------------------
// Beaming and tuplets: group 8ths/16ths/triplets inside each quarter-note
// beat, like MuseScore. The app ignores beams, but OSMD uses them to draw.
// ---------------------------------------------------------------------------

function computeBeams(notes, divisions) {
  let pos = 0
  const beats = new Map()
  notes.forEach((n, i) => {
    const beat = Math.floor((pos + 1e-9) / divisions)
    if (!beats.has(beat)) beats.set(beat, [])
    beats.get(beat).push(i)
    pos += n.dur
  })
  const beams = notes.map(() => [])
  for (const idxs of beats.values()) {
    const beamable = idxs.filter((i) => notes[i].keys && notes[i].dur < divisions)
    // A beam only makes sense when the whole beat is beamable notes in a row.
    if (beamable.length < 2 || beamable.length !== idxs.length) continue
    beamable.forEach((i, k) => {
      const level1 = k === 0 ? 'begin' : k === beamable.length - 1 ? 'end' : 'continue'
      beams[i].push([1, level1])
    })
    // Second beam for 16ths.
    const is16 = (i) => !notes[i].triplet && notes[i].sixteenths === 1
    beamable.forEach((i, k) => {
      if (!is16(i)) return
      const prev16 = k > 0 && is16(beamable[k - 1])
      const next16 = k < beamable.length - 1 && is16(beamable[k + 1])
      let v
      if (prev16 && next16) v = 'continue'
      else if (next16) v = 'begin'
      else if (prev16) v = 'end'
      else v = k === 0 ? 'forward hook' : 'backward hook'
      beams[i].push([2, v])
    })
  }
  return beams
}

/** Mark the first and last note of every group of three triplet notes. */
function computeTuplets(notes) {
  const marks = notes.map(() => null)
  let run = 0
  notes.forEach((n, i) => {
    if (!n.triplet) {
      if (run % 3 !== 0) throw new Error('Triplets must come in groups of three')
      run = 0
      return
    }
    if (run % 3 === 0) marks[i] = 'start'
    if (run % 3 === 2) marks[i] = 'stop'
    run++
  })
  if (run % 3 !== 0) throw new Error('Triplets must come in groups of three')
  return marks
}

// ---------------------------------------------------------------------------
// XML writers
// ---------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function partList(palette, partName, abbr) {
  const ids = Object.values(palette)
  const instruments = ids
    .map((i) => `      <score-instrument id="${i.id}">\n        <instrument-name>${esc(i.name)}</instrument-name>\n      </score-instrument>`)
    .join('\n')
  const midis = ids
    .map(
      (i) =>
        `      <midi-instrument id="${i.id}">\n        <midi-channel>10</midi-channel>\n        <midi-program>1</midi-program>\n        <midi-unpitched>${i.midi + 1}</midi-unpitched>\n        <volume>78.7402</volume>\n        <pan>0</pan>\n      </midi-instrument>`,
    )
    .join('\n')
  return `  <part-list>
    <score-part id="P1">
      <part-name>${esc(partName)}</part-name>
      <part-abbreviation>${esc(abbr)}</part-abbreviation>
${instruments}
      <midi-device port="1"></midi-device>
${midis}
    </score-part>
  </part-list>`
}

const TRIPLET_XML = '        <time-modification>\n          <actual-notes>3</actual-notes>\n          <normal-notes>2</normal-notes>\n        </time-modification>'

function noteXml(palette, n, voice, beams, tuplet) {
  const stem = voice === 1 ? 'up' : 'down'
  const [type, dots] = n.triplet ? ['eighth', 0] : TYPES[n.sixteenths]
  const tupletXml = tuplet ? `\n          <tuplet type="${tuplet}" bracket="yes"/>` : ''
  if (!n.keys) {
    const lines = ['      <note>', '        <rest/>', `        <duration>${n.dur}</duration>`, `        <voice>${voice}</voice>`, `        <type>${type}</type>`]
    if (dots) lines.push('        <dot/>')
    if (n.triplet) lines.push(TRIPLET_XML)
    if (tuplet) lines.push(`        <notations>${tupletXml}\n        </notations>`)
    lines.push('      </note>')
    return lines.join('\n')
  }
  return n.keys
    .map(({ key, accent, ghost }, k) => {
      const inst = palette[key]
      if (!inst) throw new Error(`Unknown instrument key "${key}"`)
      const lines = ['      <note>']
      if (k > 0) lines.push('        <chord/>')
      lines.push(
        `        <unpitched>\n          <display-step>${inst.step}</display-step>\n          <display-octave>${inst.octave}</display-octave>\n        </unpitched>`,
        `        <duration>${n.dur}</duration>`,
        `        <instrument id="${inst.id}"/>`,
        `        <voice>${voice}</voice>`,
        `        <type>${type}</type>`,
      )
      if (dots) lines.push('        <dot/>')
      if (n.triplet) lines.push(TRIPLET_XML)
      lines.push(`        <stem>${stem}</stem>`)
      // Ghost / feathered notes are written with the notehead in parentheses.
      if (ghost) lines.push(`        <notehead parentheses="yes">${inst.head ?? 'normal'}</notehead>`)
      else if (inst.head) lines.push(`        <notehead>${inst.head}</notehead>`)
      if (k === 0) for (const [num, val] of beams) lines.push(`        <beam number="${num}">${val}</beam>`)
      const notations = []
      if (k === 0 && tuplet) notations.push(tupletXml)
      if (accent) notations.push('\n          <articulations>\n            <accent/>\n          </articulations>')
      if (notations.length) lines.push(`        <notations>${notations.join('')}\n        </notations>`)
      // Sticking goes on the first note of a chord only.
      if (k === 0 && n.sticking)
        lines.push(`        <lyric number="1">\n          <syllabic>single</syllabic>\n          <text>${n.sticking}</text>\n        </lyric>`)
      lines.push('      </note>')
      return lines.join('\n')
    })
    .join('\n')
}

function wordsXml(text) {
  return `      <direction placement="above">
        <direction-type>
          <words font-style="italic">${esc(text)}</words>
        </direction-type>
      </direction>`
}

/** "Swing" text plus MusicXML 4's playback instruction: off-beat 8ths in a 2:1 (triplet) ratio. */
function swingXml(text) {
  return `      <direction placement="above">
        <direction-type>
          <words font-weight="bold">${esc(text)}</words>
        </direction-type>
        <sound>
          <swing>
            <first>2</first>
            <second>1</second>
            <swing-type>eighth</swing-type>
          </swing>
        </sound>
      </direction>`
}

/**
 * Build a complete score.
 * measures: [{ v1: string, v2?: string, words?: string, wordsAt?: {index, text}[],
 *              repeatStart?, repeatEnd?, ending?: '1'|'2', endingEnd? }]
 * swing: text for a swing marking (e.g. "Medium swing"), or omitted for straight 8ths.
 * divisions: MusicXML divisions per quarter note (must be divisible by 3 for triplets).
 */
function buildScore({ title, palette, partName, abbr, tempo, time = [4, 4], measures, oneLine = false, swing, divisions = 4 }) {
  // Assign MuseScore-style instrument ids: "P1-I" + (GM note + 1).
  for (const inst of Object.values(palette)) inst.id = `P1-I${inst.midi + 1}`

  const measureLen = (divisions * 4 * time[0]) / time[1]
  const body = measures
    .map((m, mi) => {
      const out = []
      const num = mi + 1
      out.push(`    <measure number="${num}">`)
      // Left barline: repeat start and/or ending start.
      if (m.repeatStart || m.ending) {
        out.push('      <barline location="left">')
        if (m.ending) out.push(`        <ending number="${m.ending}" type="start">${m.ending}.</ending>`)
        if (m.repeatStart) out.push('        <bar-style>heavy-light</bar-style>\n        <repeat direction="forward"/>')
        out.push('      </barline>')
      }
      if (mi === 0) {
        out.push(`      <attributes>
        <divisions>${divisions}</divisions>
        <key>
          <fifths>0</fifths>
          <mode>none</mode>
        </key>
        <time>
          <beats>${time[0]}</beats>
          <beat-type>${time[1]}</beat-type>
        </time>
        <clef>
          <sign>percussion</sign>
          <line>2</line>
        </clef>${oneLine ? '\n        <staff-details>\n          <staff-lines>1</staff-lines>\n        </staff-details>' : ''}
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">
            <beat-unit>quarter</beat-unit>
            <per-minute>${tempo}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${tempo}"/>
      </direction>`)
        if (swing) out.push(swingXml(swing))
      }
      // On bar 1 the swing marking sits at the start, so a label there moves
      // to beat 2 to keep the two texts from running together.
      const labelAtBeat2 = mi === 0 && !!swing && !!m.words
      if (m.words && !labelAtBeat2) out.push(wordsXml(m.words))

      for (const [voice, pattern] of [
        [1, m.v1],
        [2, m.v2],
      ]) {
        if (!pattern) continue
        const notes = seq(pattern)
        for (const n of notes) {
          n.dur = n.triplet ? divisions / 3 : (n.sixteenths * divisions) / 4
          if (!Number.isInteger(n.dur)) throw new Error(`${title}: divisions ${divisions} can't express ${n.triplet ? 'triplets' : n.sixteenths + ' sixteenths'}`)
        }
        const total = notes.reduce((s, n) => s + n.dur, 0)
        if (total !== measureLen) throw new Error(`${title} m${num} v${voice}: ${total} divisions, expected ${measureLen}`)
        if (voice === 2) out.push(`      <backup>\n        <duration>${measureLen}</duration>\n      </backup>`)
        const beams = computeBeams(notes, divisions)
        const tuplets = computeTuplets(notes)
        notes.forEach((n, i) => {
          const w = m.wordsAt?.find((x) => x.index === i && voice === 1)
          if (w) out.push(wordsXml(w.text))
          if (labelAtBeat2 && voice === 1 && i === 1) out.push(wordsXml(m.words))
          out.push(noteXml(palette, n, voice, beams[i], tuplets[i]))
        })
      }

      // Right barline: repeat end, ending stop, or the final double bar.
      const isLast = mi === measures.length - 1
      if (m.repeatEnd || m.endingEnd || isLast) {
        out.push('      <barline location="right">')
        out.push(`        <bar-style>${m.repeatEnd || isLast ? 'light-heavy' : 'regular'}</bar-style>`)
        if (m.endingEnd) out.push(`        <ending number="${m.endingEnd.number}" type="${m.endingEnd.type}"/>`)
        if (m.repeatEnd) out.push('        <repeat direction="backward"/>')
        out.push('      </barline>')
      }
      out.push('    </measure>')
      return out.join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${esc(title)}</work-title>
  </work>
  <identification>
    <creator type="composer">StickTrack</creator>
    <encoding>
      <software>StickTrack sample generator</software>
    </encoding>
  </identification>
${partList(palette, partName, abbr)}
  <part id="P1">
${body}
  </part>
</score-partwise>
`
}

const KIT_SCORE = { palette: KIT, partName: 'Drumset', abbr: 'D. Set' }

// ---------------------------------------------------------------------------
// Rock and groove samples
// ---------------------------------------------------------------------------

const BACKBEAT = '2:hh 2:hh 2:hh+snare 2:hh 2:hh 2:hh 2:hh+snare 2:hh'
const KICK_1_3 = '4:kick 4:r 4:kick 4:r'

/** Basic rock beat: four bars played twice, then a crash to end. */
const rockBeat = buildScore({
  ...KIT_SCORE,
  title: 'Basic Rock Beat',
  tempo: 100,
  measures: [
    { v1: BACKBEAT, v2: KICK_1_3, repeatStart: true },
    { v1: BACKBEAT, v2: KICK_1_3 },
    { v1: BACKBEAT, v2: KICK_1_3 },
    // Bar 4 adds a kick on the "and" of 3.
    { v1: BACKBEAT, v2: '4:kick 4:r 2:kick 2:kick 4:r', repeatEnd: true },
    { v1: '8:crash 8:r', v2: '8:kick 8:r' },
  ],
})

/** 8th-note groove with fills, using 1st/2nd endings. */
const GROOVE = '2:hh 2:hh 2:hh+snare 2:hh 2:hh 2:hh 2:hh+snare 2:hh'
const GROOVE_KICK = '4:kick 2:r 2:kick 2:r 2:kick 4:r'
const grooveFills = buildScore({
  ...KIT_SCORE,
  title: '8th-Note Groove with Fills',
  tempo: 108,
  measures: [
    { v1: '2:crash 2:hh 2:hh+snare 2:hh 2:hh 2:hh 2:hh+snare 2:hh', v2: GROOVE_KICK, repeatStart: true },
    // Open hi-hat on the "and" of 4, closed by the pedal on the next downbeat.
    { v1: '2:hh 2:hh 2:hh+snare 2:hh 2:hh 2:hh 2:hh+snare 2:ohh', v2: GROOVE_KICK },
    { v1: GROOVE, v2: '4:kick+pedal 2:r 2:kick 2:r 2:kick 4:pedal' },
    // 1st ending: a short snare fill on beat 4.
    {
      v1: `2:hh 2:hh 2:hh+snare 2:hh 2:hh 2:hh 1:snare! 1:snare 1:snare 1:snare`,
      v2: '4:kick 2:r 2:kick 2:r 2:kick 4:r',
      ending: '1',
      endingEnd: { number: '1', type: 'stop' },
      repeatEnd: true,
    },
    // 2nd ending: a full-bar fill around the toms with accents on each beat.
    {
      v1: '1:snare! 1:snare 1:snare 1:snare 1:tom1! 1:tom1 1:tom1 1:tom1 1:tom2! 1:tom2 1:tom2 1:tom2 1:floor! 1:floor 1:floor 1:floor',
      v2: '4:kick 4:kick 4:kick 4:kick',
      ending: '2',
      endingEnd: { number: '2', type: 'discontinue' },
    },
    { v1: '2:ride+crash 2:ride 2:ride+snare 2:ride 2:ride 2:ride 2:ride+snare 2:ride', v2: GROOVE_KICK },
    { v1: '2:ride 2:ride 2:ride+snare 2:ride 2:ride 2:ride 1:snare! 1:tom1 1:tom2 1:floor', v2: GROOVE_KICK },
    { v1: '8:crash 8:r', v2: '8:kick 8:r' },
  ],
})

// ---------------------------------------------------------------------------
// Jazz samples. All are written the way jazz charts are: straight 8ths with
// a "Swing" marking, which the app plays with the off-beat 8th late (on the
// last note of a triplet). Cymbals are stems up; snare, bass drum and hi-hat
// foot are stems down, as in most jazz drumming books.
// ---------------------------------------------------------------------------

/** The jazz ride pattern ("spang, spang-a-lang"): 1, 2 &, 3, 4 &. */
const RIDE = '4:ride 2:ride 2:ride 4:ride 2:ride 2:ride'
/** Hi-hat closed with the foot on beats 2 and 4. */
const HH_2_4 = '4:r 4:pedal 4:r 4:pedal'
/** "Feathered" bass drum: very soft quarter notes, felt more than heard. */
const FEATHER = '4:kick~ 4:kick~+pedal 4:kick~ 4:kick~+pedal'
const ENDING_4_4 = { v1: '4:ride+crash 4:r 8:r', v2: '4:kick 4:pedal 8:r' }

/** Jazz 1. The basic time feel: ride pattern, hi-hat on 2 & 4, feathered bass drum. */
const jazzTime = buildScore({
  ...KIT_SCORE,
  title: 'Jazz Time: Ride Pattern & Hi-Hat',
  tempo: 120,
  swing: 'Medium swing',
  measures: [
    { v1: RIDE, v2: HH_2_4, words: 'Ride + hi-hat on 2 & 4', repeatStart: true },
    { v1: RIDE, v2: HH_2_4 },
    { v1: RIDE, v2: FEATHER, words: 'Add the feathered bass drum' },
    { v1: RIDE, v2: FEATHER, repeatEnd: true },
    ENDING_4_4,
  ],
})

/** Jazz 2. Comping: short snare and bass-drum figures under steady time. */
const jazzComping = buildScore({
  ...KIT_SCORE,
  title: 'Jazz Comping: Snare & Bass Drum',
  tempo: 132,
  swing: 'Swing',
  measures: [
    { v1: RIDE, v2: '4:r 2:pedal 2:r 4:r 2:pedal 2:snare', words: '"and" of 4' },
    { v1: RIDE, v2: '4:r 2:pedal 2:snare 4:r 2:pedal 2:r', words: '"and" of 2' },
    // The Charleston rhythm: beat 1 and the "and" of 2.
    { v1: RIDE, v2: '2:snare! 2:r 2:pedal 2:snare 4:r 2:pedal 2:r', words: 'Charleston' },
    // A "bomb": an accented bass drum on the "and" of 4, set up by the snare.
    { v1: RIDE, v2: '4:r 2:pedal 2:r 4:r 2:pedal+snare 2:kick!', words: 'bass drum bomb' },
    { v1: RIDE, v2: '2:r 2:snare~ 2:pedal 2:r 2:r 2:snare~ 2:pedal 2:snare!', words: 'ghost notes' },
    { v1: RIDE, v2: '2:kick 2:r 2:pedal 2:snare 2:r 2:kick 2:pedal 2:snare', words: 'snare / bass conversation' },
    { v1: RIDE, v2: '2:r 2:snare 2:pedal 2:r 4:kick 2:pedal 2:r', words: '"and" of 1' },
    { v1: RIDE, v2: '4:r 2:pedal 2:r 2:r 2:snare 2:pedal 2:kick!' },
    ENDING_4_4,
  ],
})

/** Jazz 3. Jazz waltz in 3/4. */
const WALTZ_RIDE = '4:ride 2:ride 2:ride 4:ride'
const jazzWaltz = buildScore({
  ...KIT_SCORE,
  title: 'Jazz Waltz',
  tempo: 152,
  time: [3, 4],
  swing: 'Jazz waltz',
  measures: [
    { v1: WALTZ_RIDE, v2: '4:kick~ 4:pedal 4:r', words: 'Ride 1, 2 &, 3 · hi-hat on 2', repeatStart: true },
    { v1: WALTZ_RIDE, v2: '4:kick~ 4:pedal 4:r' },
    { v1: WALTZ_RIDE, v2: '4:kick~ 4:pedal 2:r 2:snare' },
    { v1: WALTZ_RIDE, v2: '4:kick~ 4:pedal 2:r 2:kick', repeatEnd: true },
    { v1: WALTZ_RIDE, v2: '4:kick~ 4:pedal 4:pedal', words: 'Hi-hat on 2 & 3' },
    { v1: WALTZ_RIDE, v2: '4:kick~ 4:pedal 4:pedal' },
    { v1: WALTZ_RIDE, v2: '4:kick~ 2:pedal 2:snare 4:pedal' },
    { v1: WALTZ_RIDE, v2: '2:kick 2:snare~ 4:pedal 2:r 2:snare!' },
    { v1: '4:ride+crash 8:r', v2: '4:kick 8:r' },
  ],
})

/** Jazz 4. Three bars of time, then a bar of triplet fill — the classic 4-bar phrase. */
const jazzFills = buildScore({
  ...KIT_SCORE,
  title: 'Jazz Time & Triplet Fills',
  tempo: 140,
  swing: 'Swing',
  divisions: 12, // 12 per quarter so 8th-note triplets (4 each) fit exactly
  measures: [
    { v1: RIDE, v2: FEATHER, words: '3 bars of time' },
    { v1: RIDE, v2: FEATHER },
    { v1: RIDE, v2: '4:kick~ 4:kick~+pedal 4:kick~ 2:kick~+pedal 2:snare' },
    // One bar of 8th-note triplets around the kit, single strokes.
    {
      v1: 'T:snare!@R T:snare@L T:snare@R T:snare!@L T:snare@R T:tom1@L T:tom1!@R T:tom2@L T:tom2@R T:floor!@L T:floor@R T:floor@L',
      v2: HH_2_4,
      words: 'Fill: triplets around the kit',
    },
    { v1: RIDE, v2: FEATHER, words: '3 bars of time' },
    { v1: RIDE, v2: FEATHER },
    { v1: RIDE, v2: FEATHER },
    // The classic "hand, hand, foot" triplet: R L then bass drum.
    {
      v1: 'T:snare!@R T:snare@L T:kick T:tom1!@R T:tom1@L T:kick T:tom2!@R T:tom2@L T:kick T:floor!@R T:floor@L T:kick',
      v2: HH_2_4,
      words: 'Fill: hand-hand-foot triplets',
    },
    ENDING_4_4,
  ],
})

// ---------------------------------------------------------------------------
// Marching and test samples
// ---------------------------------------------------------------------------

/** Marching snare: 8-on-a-hand, accent/tap, and a zone check bar. */
const accentTap = (accentIndex) =>
  Array.from({ length: 16 }, (_, i) => `1:sn${i % 4 === accentIndex ? '!' : ''}@${i % 2 === 0 ? 'R' : 'L'}`).join(' ')

const marching = buildScore({
  title: 'Marching Snare: 8 on a Hand + Accent/Tap',
  palette: MARCHING,
  partName: 'Marching Snare',
  abbr: 'M. Sn.',
  tempo: 120,
  oneLine: true,
  measures: [
    { v1: '2:sn!@R ' + rep('2:sn@R', 7), words: '8 on a hand' },
    { v1: '2:sn!@L ' + rep('2:sn@L', 7) },
    { v1: '2:sn!@R ' + rep('2:sn@R', 3) + ' 2:sn!@L ' + rep('2:sn@L', 3) },
    { v1: '2:sn!@R 2:sn@R 2:sn!@L 2:sn@L 2:sn!@R 2:sn@R 2:sn!@L 2:sn@L' },
    { v1: '2:sn!@R 2:sn@L 2:sn!@R 2:sn@L 2:sn!@R 2:sn@L 2:sn!@R 2:sn@L' },
    { v1: '4:sn!@R 4:r 8:r' },
    { v1: accentTap(0), words: 'Accent / tap' },
    { v1: accentTap(1) },
    { v1: accentTap(2) },
    { v1: accentTap(3) },
    // Zone check: center, edge (diamond heads), stick clicks (x above), rim shot (x on the line).
    {
      v1: '2:sn@R 2:sn@L 2:edge@R 2:edge@L 2:click@R 2:click@L 4:rim!@R',
      wordsAt: [
        { index: 2, text: 'edge' },
        { index: 4, text: 'clicks' },
        { index: 6, text: 'rim' },
      ],
    },
  ],
})

/** Drift check: 32 bars at 160 BPM, crash on every 4th downbeat. */
const driftCheck = buildScore({
  ...KIT_SCORE,
  title: 'Drift Check: 32 Bars at 160',
  tempo: 160,
  measures: Array.from({ length: 32 }, (_, i) => ({
    v1: i % 4 === 0 ? '2:crash ' + BACKBEAT.split(' ').slice(1).join(' ') : BACKBEAT,
    v2: KICK_1_3,
  })),
})

mkdirSync(OUT_DIR, { recursive: true })
const files = {
  'rock-beat.musicxml': rockBeat,
  'groove-with-fills.musicxml': grooveFills,
  'jazz-time.musicxml': jazzTime,
  'jazz-comping.musicxml': jazzComping,
  'jazz-waltz.musicxml': jazzWaltz,
  'jazz-triplet-fills.musicxml': jazzFills,
  'marching-8-on-a-hand.musicxml': marching,
  'drift-check-32-bars.musicxml': driftCheck,
}
for (const [name, xml] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), xml)
  console.log(`wrote src/samples/${name}`)
}

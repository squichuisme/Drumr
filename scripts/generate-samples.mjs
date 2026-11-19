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
 *   - hands are written in voice 1 (stems up) and feet in voice 2
 *     (stems down), separated by <backup>.
 *
 * Run with:  node scripts/generate-samples.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'samples')
const DIVISIONS = 4 // divisions per quarter note, so 1 division = one 16th note

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
//   "2:hh+snare!@R"  =  an 8th note (2 sixteenths) playing hi-hat and snare
//                       together, accented (!), sticking R (@R)
//   "4:r"            =  a quarter rest
// ---------------------------------------------------------------------------

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
      const m = token.match(/^(\d+):([a-z0-9+]+)(!?)(?:@([RL]))?$/)
      if (!m) throw new Error(`Bad token "${token}"`)
      const dur = Number(m[1])
      if (!TYPES[dur]) throw new Error(`Unsupported duration ${dur} in "${token}"`)
      return {
        dur,
        keys: m[2] === 'r' ? null : m[2].split('+'),
        accent: m[3] === '!',
        sticking: m[4] ?? null,
      }
    })
}

/** Repeat a pattern string n times. */
const rep = (pattern, n) => Array(n).fill(pattern).join(' ')

// ---------------------------------------------------------------------------
// Beaming: group 8ths/16ths inside each quarter-note beat, like MuseScore.
// The app ignores beams, but OSMD uses them to draw the score.
// ---------------------------------------------------------------------------

function computeBeams(notes, beatLen = DIVISIONS) {
  let pos = 0
  const beats = new Map()
  notes.forEach((n, i) => {
    const beat = Math.floor(pos / beatLen)
    if (!beats.has(beat)) beats.set(beat, [])
    beats.get(beat).push(i)
    pos += n.dur
  })
  const beams = notes.map(() => [])
  for (const idxs of beats.values()) {
    const beamable = idxs.filter((i) => notes[i].keys && notes[i].dur < DIVISIONS)
    // A beam only makes sense when the whole beat is beamable notes in a row.
    if (beamable.length < 2 || beamable.length !== idxs.length) continue
    beamable.forEach((i, k) => {
      const level1 = k === 0 ? 'begin' : k === beamable.length - 1 ? 'end' : 'continue'
      beams[i].push([1, level1])
    })
    // Second beam for 16ths.
    beamable.forEach((i, k) => {
      if (notes[i].dur !== 1) return
      const prev16 = k > 0 && notes[beamable[k - 1]].dur === 1
      const next16 = k < beamable.length - 1 && notes[beamable[k + 1]].dur === 1
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

function noteXml(palette, n, voice, beams) {
  const stem = voice === 1 ? 'up' : 'down'
  const [type, dots] = TYPES[n.dur]
  const dotXml = dots ? '\n        <dot/>' : ''
  if (!n.keys) {
    return `      <note>
        <rest/>
        <duration>${n.dur}</duration>
        <voice>${voice}</voice>
        <type>${type}</type>${dotXml}
      </note>`
  }
  return n.keys
    .map((key, k) => {
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
      lines.push(`        <stem>${stem}</stem>`)
      if (inst.head) lines.push(`        <notehead>${inst.head}</notehead>`)
      if (k === 0) for (const [num, val] of beams) lines.push(`        <beam number="${num}">${val}</beam>`)
      // Articulations and sticking go on the first note of a chord only.
      if (k === 0 && n.accent) lines.push('        <notations>\n          <articulations>\n            <accent/>\n          </articulations>\n        </notations>')
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

/**
 * Build a complete score.
 * measures: [{ v1: string, v2?: string, words?: string, repeatStart?, repeatEnd?, ending?: '1'|'2', endingEnd?, wordsBefore?: {index, text}[] }]
 */
function buildScore({ title, palette, partName, abbr, tempo, time = [4, 4], measures, oneLine = false }) {
  // Assign MuseScore-style instrument ids: "P1-I" + (GM note + 1).
  for (const inst of Object.values(palette)) inst.id = `P1-I${inst.midi + 1}`

  const measureLen = (DIVISIONS * 4 * time[0]) / time[1]
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
        <divisions>${DIVISIONS}</divisions>
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
      }
      if (m.words) out.push(wordsXml(m.words))

      for (const [voice, pattern] of [
        [1, m.v1],
        [2, m.v2],
      ]) {
        if (!pattern) continue
        const notes = seq(pattern)
        const total = notes.reduce((s, n) => s + n.dur, 0)
        if (total !== measureLen) throw new Error(`${title} m${num} v${voice}: ${total} sixteenths, expected ${measureLen}`)
        if (voice === 2) out.push(`      <backup>\n        <duration>${measureLen}</duration>\n      </backup>`)
        const beams = computeBeams(notes)
        notes.forEach((n, i) => {
          const w = m.wordsAt?.find((x) => x.index === i && voice === 1)
          if (w) out.push(wordsXml(w.text))
          out.push(noteXml(palette, n, voice, beams[i]))
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

// ---------------------------------------------------------------------------
// The samples
// ---------------------------------------------------------------------------

const BACKBEAT = '2:hh 2:hh 2:hh+snare 2:hh 2:hh 2:hh 2:hh+snare 2:hh'
const KICK_1_3 = '4:kick 4:r 4:kick 4:r'

/** 1. Basic rock beat: four bars played twice, then a crash to end. */
const rockBeat = buildScore({
  title: 'Basic Rock Beat',
  palette: KIT,
  partName: 'Drumset',
  abbr: 'D. Set',
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

/** 2. 8th-note groove with fills, using 1st/2nd endings. */
const GROOVE = '2:hh 2:hh 2:hh+snare 2:hh 2:hh 2:hh 2:hh+snare 2:hh'
const GROOVE_KICK = '4:kick 2:r 2:kick 2:r 2:kick 4:r'
const grooveFills = buildScore({
  title: '8th-Note Groove with Fills',
  palette: KIT,
  partName: 'Drumset',
  abbr: 'D. Set',
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

/** 3. Marching snare: 8-on-a-hand, accent/tap, and a zone check bar. */
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

/** 4. Drift check: 32 bars at 160 BPM, crash on every 4th downbeat. */
const driftCheck = buildScore({
  title: 'Drift Check: 32 Bars at 160',
  palette: KIT,
  partName: 'Drumset',
  abbr: 'D. Set',
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
  'marching-8-on-a-hand.musicxml': marching,
  'drift-check-32-bars.musicxml': driftCheck,
}
for (const [name, xml] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), xml)
  console.log(`wrote src/samples/${name}`)
}

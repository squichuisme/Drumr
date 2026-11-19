import { describe, expect, it } from 'vitest'
import { parseScore } from './parseScore'
import type { NoteEvent, ScoreTimeline, Voice } from './types'
import rockBeatXml from '../samples/rock-beat.musicxml?raw'
import grooveXml from '../samples/groove-with-fills.musicxml?raw'
import marchingXml from '../samples/marching-8-on-a-hand.musicxml?raw'
import driftXml from '../samples/drift-check-32-bars.musicxml?raw'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Events at exactly this beat, as a sorted list of voices. */
function voicesAt(t: ScoreTimeline, beat: number): Voice[] {
  return t.events
    .filter((e) => e.beat === beat)
    .map((e) => e.voice)
    .sort()
}

function eventsOf(t: ScoreTimeline, voice: Voice, measureIndex?: number): NoteEvent[] {
  return t.events.filter((e) => e.voice === voice && (measureIndex === undefined || e.measureIndex === measureIndex))
}

function eventsInMeasure(t: ScoreTimeline, measureIndex: number): NoteEvent[] {
  return t.events.filter((e) => e.measureIndex === measureIndex)
}

/**
 * Build a tiny one-part score. `measures` are the inner XML of each measure;
 * the first gets standard attributes (divisions 4 = a 16th per division).
 */
function score(measures: string[], opts: { partList?: string; attributes?: string } = {}): string {
  const attributes =
    opts.attributes ??
    `<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
       <clef><sign>percussion</sign><line>2</line></clef></attributes>`
  return `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list>${opts.partList ?? '<score-part id="P1"><part-name>Drums</part-name></score-part>'}</part-list>
  <part id="P1">
    ${measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? attributes : ''}${m}</measure>`).join('\n')}
  </part>
</score-partwise>`
}

/** An unpitched note. dur in 16ths. */
function n(step: string, octave: number, dur: number, extra = '', head = ''): string {
  return `<note><unpitched><display-step>${step}</display-step><display-octave>${octave}</display-octave></unpitched>
    <duration>${dur}</duration><voice>1</voice>${head ? `<notehead>${head}</notehead>` : ''}${extra}</note>`
}
const rest = (dur: number) => `<note><rest/><duration>${dur}</duration><voice>1</voice></note>`
const chord = (note: string) => note.replace('<note>', '<note><chord/>')

// ---------------------------------------------------------------------------
// Sample scores
// ---------------------------------------------------------------------------

describe('sample: basic rock beat', () => {
  const t = parseScore(rockBeatXml)

  it('reads title and tempo', () => {
    expect(t.title).toBe('Basic Rock Beat')
    expect(t.tempo).toBe(100)
    expect(t.tempoFromScore).toBe(true)
  })

  it('unrolls the repeat: bars 1-4 twice, then the ending bar', () => {
    expect(t.measures.map((m) => m.sourceIndex)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4])
    expect(t.measures.map((m) => m.startBeat)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32])
    expect(t.totalBeats).toBe(36)
  })

  it('maps bar 1 to hi-hat 8ths, snare on 2 & 4, kick on 1 & 3', () => {
    expect(eventsOf(t, 'hihatClosed', 0).map((e) => e.beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(eventsOf(t, 'snare', 0).map((e) => e.beat)).toEqual([1, 3])
    expect(eventsOf(t, 'kick', 0).map((e) => e.beat)).toEqual([0, 2])
  })

  it('puts simultaneous hits (hands in voice 1, feet in voice 2) on the same beat', () => {
    expect(voicesAt(t, 0)).toEqual(['hihatClosed', 'kick'])
    expect(voicesAt(t, 1)).toEqual(['hihatClosed', 'snare'])
    expect(voicesAt(t, 0.5)).toEqual(['hihatClosed'])
  })

  it('plays the extra kick on the "and" of 3 in bar 4, both times through', () => {
    expect(eventsOf(t, 'kick', 3).map((e) => e.beat)).toEqual([12, 14, 14.5])
    expect(eventsOf(t, 'kick', 7).map((e) => e.beat)).toEqual([28, 30, 30.5])
  })

  it('ends with crash + kick', () => {
    expect(voicesAt(t, 32)).toEqual(['crash', 'kick'])
  })

  it('has the right number of hits and no warnings', () => {
    // 3 bars x 12 hits + bar 4 with 13, played twice, then 2 hits.
    expect(t.events).toHaveLength((12 * 3 + 13) * 2 + 2)
    expect(t.warnings).toEqual([])
    expect(t.suggestedMode).toBe('kit')
    expect(t.hasSticking).toBe(false)
  })

  it('records source measure numbers for each event', () => {
    const lastBarEvents = eventsInMeasure(t, 8)
    expect(lastBarEvents.every((e) => e.sourceMeasureIndex === 4)).toBe(true)
  })
})

describe('sample: 8th-note groove with fills', () => {
  const t = parseScore(grooveXml)

  it('follows 1st and 2nd endings', () => {
    // bars 1-3, 1st ending (bar 4), bars 1-3 again, 2nd ending (bar 5), bars 6-8
    expect(t.measures.map((m) => m.sourceIndex)).toEqual([0, 1, 2, 3, 0, 1, 2, 4, 5, 6, 7])
    expect(t.totalBeats).toBe(44)
    expect(t.tempo).toBe(108)
  })

  it('maps the crash on the downbeat and the open hi-hat on the "and" of 4', () => {
    expect(voicesAt(t, 0)).toEqual(['crash', 'kick'])
    expect(eventsOf(t, 'hihatOpen', 1).map((e) => e.beat)).toEqual([7.5])
  })

  it('maps hi-hat pedal (x below the staff) together with the kick', () => {
    expect(voicesAt(t, 8)).toEqual(['hihatClosed', 'hihatPedal', 'kick'])
    expect(eventsOf(t, 'hihatPedal', 2).map((e) => e.beat)).toEqual([8, 11])
  })

  it('plays the 1st-ending snare fill as accented 16ths', () => {
    const fill = eventsOf(t, 'snare', 3).filter((e) => e.beat >= 15)
    expect(fill.map((e) => e.beat)).toEqual([15, 15.25, 15.5, 15.75])
    expect(fill.map((e) => e.accent)).toEqual([true, false, false, false])
    expect(fill[0].velocity).toBeGreaterThan(fill[1].velocity)
  })

  it('plays the 2nd-ending tom fill around the kit', () => {
    const start = t.measures[7].startBeat
    expect(start).toBe(28)
    const fill = eventsInMeasure(t, 7).filter((e) => e.voice !== 'kick')
    expect(fill.map((e) => e.voice)).toEqual([
      ...Array(4).fill('snare'),
      ...Array(4).fill('tom1'),
      ...Array(4).fill('tom2'),
      ...Array(4).fill('floorTom'),
    ])
    expect(fill.filter((e) => e.accent).map((e) => e.beat)).toEqual([28, 29, 30, 31])
  })

  it('maps the ride (x on the top line) and ride + crash together', () => {
    const start = t.measures[8].startBeat
    expect(voicesAt(t, start)).toEqual(['crash', 'kick', 'ride'])
    expect(eventsOf(t, 'ride', 8)).toHaveLength(8)
  })
})

describe('sample: marching snare 8 on a hand + accent/tap', () => {
  const t = parseScore(marchingXml)

  it('suggests the marching diagram and reads sticking', () => {
    expect(t.suggestedMode).toBe('marching')
    expect(t.hasSticking).toBe(true)
    expect(t.tempo).toBe(120)
    expect(t.warnings).toEqual([])
  })

  it('plays 8 on a hand: eight Rs then eight Ls, accent on the first', () => {
    const bar1 = eventsInMeasure(t, 0)
    expect(bar1.map((e) => e.voice)).toEqual(Array(8).fill('snare'))
    expect(bar1.map((e) => e.sticking).join('')).toBe('RRRRRRRR')
    expect(bar1.map((e) => e.accent)).toEqual([true, false, false, false, false, false, false, false])
    expect(eventsInMeasure(t, 1).map((e) => e.sticking).join('')).toBe('LLLLLLLL')
    expect(eventsInMeasure(t, 2).map((e) => e.sticking).join('')).toBe('RRRRLLLL')
    expect(eventsInMeasure(t, 3).map((e) => e.sticking).join('')).toBe('RRLLRRLL')
    expect(eventsInMeasure(t, 4).map((e) => e.sticking).join('')).toBe('RLRLRLRL')
  })

  it('gives accents a higher velocity than taps', () => {
    const [accent, tap] = eventsInMeasure(t, 0)
    expect(accent.velocity).toBe(1)
    expect(tap.velocity).toBeLessThan(0.8)
  })

  it('shifts the accent one 16th later in each accent/tap bar', () => {
    for (let k = 0; k < 4; k++) {
      const bar = eventsInMeasure(t, 6 + k)
      expect(bar).toHaveLength(16)
      const accented = bar.map((e, i) => (e.accent ? i : -1)).filter((i) => i >= 0)
      expect(accented).toEqual([k, k + 4, k + 8, k + 12])
      expect(bar.map((e) => e.sticking).join('')).toBe('RL'.repeat(8))
      expect(bar[1].beat - bar[0].beat).toBe(0.25)
    }
  })

  it('maps the zone-check bar: center, edge (diamond), stick clicks (x above), rim shot (x on line)', () => {
    const bar = eventsInMeasure(t, 10)
    expect(bar.map((e) => e.voice)).toEqual([
      'snare',
      'snare',
      'snareEdge',
      'snareEdge',
      'stickClick',
      'stickClick',
      'snareRim',
    ])
    expect(bar[6].accent).toBe(true)
  })
})

describe('sample: drift check', () => {
  const t = parseScore(driftXml)
  it('is 32 bars of 4/4 at 160 with a crash every 4 bars', () => {
    expect(t.measures).toHaveLength(32)
    expect(t.totalBeats).toBe(128)
    expect(t.tempo).toBe(160)
    expect(eventsOf(t, 'crash').map((e) => e.beat)).toEqual([0, 16, 32, 48, 64, 80, 96, 112])
    expect(t.measures[31].startBeat).toBe(124)
  })
})

// ---------------------------------------------------------------------------
// Mapping rules
// ---------------------------------------------------------------------------

describe('drum mapping by staff position (no instrument info)', () => {
  // One quarter note per staff position, four per bar.
  const cases: [string, number, string, Voice][] = [
    ['F', 4, '', 'kick'], // bottom space
    ['E', 4, '', 'kick'], // bottom line (alt kick)
    ['A', 4, '', 'floorTom'], // 2nd space
    ['C', 5, '', 'snare'], // 3rd space
    ['C', 5, 'x', 'snareRim'], // x on the snare space = cross-stick
    ['D', 5, '', 'tom2'], // 4th line
    ['E', 5, '', 'tom1'], // 4th space
    ['F', 5, 'x', 'ride'], // x on the top line
    ['F', 5, 'diamond', 'rideBell'],
    ['G', 5, 'x', 'hihatClosed'], // x above the staff
    ['G', 5, 'circle-x', 'hihatOpen'],
    ['A', 5, 'x', 'crash'], // x on the ledger line
    ['D', 4, 'x', 'hihatPedal'], // x below the staff
  ]
  for (const [step, octave, head, voice] of cases) {
    it(`${step}${octave}${head ? ` (${head})` : ''} → ${voice}`, () => {
      const t = parseScore(score([n(step, octave, 16, '', head)]))
      expect(t.events.map((e) => e.voice)).toEqual([voice])
    })
  }

  it('measures positions from the clef, so a bass-clef drum part works too', () => {
    // In bass clef the bottom space is A2 and the 3rd space is E3.
    const attrs = `<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>F</sign><line>4</line></clef></attributes>`
    const xml = score([`${n('A', 2, 8)}${n('E', 3, 8)}`], { attributes: attrs })
    // A bass-clef part with unpitched notes still counts as a drum part.
    expect(parseScore(xml).events.map((e) => e.voice)).toEqual(['kick', 'snare'])
  })

  it('reads <pitch> notes on a percussion staff the same way', () => {
    const xml = score([`<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice></note>`])
    expect(parseScore(xml).events.map((e) => e.voice)).toEqual(['snare'])
  })

  it('warns about notes the map does not cover', () => {
    const t = parseScore(score([n('C', 6, 16, '', 'triangle')]))
    expect(t.events).toEqual([])
    expect(t.warnings[0]).toMatch(/staff position 12, triangle notehead/)
  })
})

describe('drum mapping by instrument (MuseScore style)', () => {
  const partList = `<score-part id="P1"><part-name>Drumset</part-name>
    <score-instrument id="P1-I39"><instrument-name>Acoustic Snare</instrument-name></score-instrument>
    <score-instrument id="P1-I77"><instrument-name>Perc 1</instrument-name></score-instrument>
    <score-instrument id="P1-I78"><instrument-name>Mystery</instrument-name></score-instrument>
    <midi-instrument id="P1-I39"><midi-unpitched>39</midi-unpitched></midi-instrument>
    <midi-instrument id="P1-I77"><midi-unpitched>50</midi-unpitched></midi-instrument>
    </score-part>`
  const withInst = (id: string, step: string, octave: number) => n(step, octave, 4, `<instrument id="${id}"/>`)

  it('prefers the instrument name over the staff position', () => {
    // An "Acoustic Snare" written in the kick space still plays snare.
    const t = parseScore(score([withInst('P1-I39', 'F', 4) + rest(12)], { partList }))
    expect(t.events.map((e) => e.voice)).toEqual(['snare'])
  })

  it('uses the MIDI number (midi-unpitched is 1-based) when the name is unknown', () => {
    // midi-unpitched 50 → GM note 49 = crash cymbal
    const t = parseScore(score([withInst('P1-I77', 'C', 5) + rest(12)], { partList }))
    expect(t.events.map((e) => e.voice)).toEqual(['crash'])
  })

  it('falls back to the staff position when neither name nor MIDI is known', () => {
    const t = parseScore(score([withInst('P1-I78', 'E', 5) + rest(12)], { partList }))
    expect(t.events.map((e) => e.voice)).toEqual(['tom1'])
  })
})

// ---------------------------------------------------------------------------
// Timing details
// ---------------------------------------------------------------------------

describe('timing', () => {
  it('handles chords and <backup> between voices', () => {
    const xml = score([
      n('G', 5, 8, '', 'x') + chord(n('C', 5, 8)) + n('G', 5, 8, '', 'x') +
        '<backup><duration>16</duration></backup>' +
        n('F', 4, 4) + rest(4) + n('F', 4, 4) + rest(4),
    ])
    const t = parseScore(xml)
    expect(voicesAt(t, 0)).toEqual(['hihatClosed', 'kick', 'snare'])
    expect(voicesAt(t, 2)).toEqual(['hihatClosed', 'kick'])
  })

  it('handles <forward> (invisible rests)', () => {
    const xml = score(['<forward><duration>8</duration></forward>' + n('C', 5, 8)])
    expect(parseScore(xml).events.map((e) => e.beat)).toEqual([2])
  })

  it('does not re-strike the second half of a tied note', () => {
    const xml = score([n('C', 5, 8) + n('C', 5, 8, '<tie type="start"/>'), n('C', 5, 16, '<tie type="stop"/>')])
    expect(parseScore(xml).events.map((e) => e.beat)).toEqual([0, 2])
  })

  it('places grace notes (flams) just before the main note, softly', () => {
    const grace = `<note><grace/><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><voice>1</voice></note>`
    const xml = score([rest(4) + grace + n('C', 5, 12, '<notations><articulations><accent/></articulations></notations>')])
    const t = parseScore(xml)
    expect(t.events).toHaveLength(2)
    const [g, main] = t.events
    expect(g.grace).toBe(true)
    expect(g.beat).toBeCloseTo(1 - 0.06, 6)
    expect(main.beat).toBe(1)
    expect(g.velocity).toBeLessThan(main.velocity)
  })

  it('expands single-note tremolos (2 slashes on a quarter = four 16ths)', () => {
    const trem = '<notations><ornaments><tremolo type="single">2</tremolo></ornaments></notations>'
    const xml = score([n('C', 5, 4, trem) + rest(12)])
    expect(parseScore(xml).events.map((e) => e.beat)).toEqual([0, 0.25, 0.5, 0.75])
  })

  it('handles tuplets via <duration> (triplet 8ths land on thirds of a beat)', () => {
    // divisions = 3 so an 8th-note triplet is 1 division each.
    const attrs = `<attributes><divisions>3</divisions><time><beats>1</beats><beat-type>4</beat-type></time>
      <clef><sign>percussion</sign></clef></attributes>`
    const xml = score([n('C', 5, 1) + n('C', 5, 1) + n('C', 5, 1)], { attributes: attrs })
    const beats = parseScore(xml).events.map((e) => e.beat)
    expect(beats[0]).toBe(0)
    expect(beats[1]).toBeCloseTo(1 / 3, 6)
    expect(beats[2]).toBeCloseTo(2 / 3, 6)
  })

  it('uses the real length of a pickup (implicit) measure', () => {
    const xml = score([n('C', 5, 4)]).replace('<measure number="1">', '<measure number="0" implicit="yes">')
    const withSecond = xml.replace('</part>', `<measure number="1">${n('F', 4, 16)}</measure></part>`)
    const t = parseScore(withSecond)
    expect(t.measures.map((m) => m.lengthBeats)).toEqual([1, 4])
    expect(t.events.map((e) => e.beat)).toEqual([0, 1])
  })

  it('converts a dotted-quarter metronome mark to quarter-note BPM', () => {
    const dir = `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>`
    expect(parseScore(score([dir + n('C', 5, 16)])).tempo).toBe(120)
  })

  it('falls back to the default tempo when the score has none', () => {
    const t = parseScore(score([n('C', 5, 16)]))
    expect(t.tempo).toBe(100)
    expect(t.tempoFromScore).toBe(false)
  })
})

describe('repeats', () => {
  const bar = (step: string) => n(step, 5, 16)
  const fwd = '<barline location="left"><repeat direction="forward"/></barline>'
  const back = (times?: number) =>
    `<barline location="right"><repeat direction="backward"${times ? ` times="${times}"` : ''}/></barline>`

  it('honours times="3"', () => {
    const t = parseScore(score([fwd + bar('C') + back(3), bar('E')]))
    expect(t.measures.map((m) => m.sourceIndex)).toEqual([0, 0, 0, 1])
  })

  it('handles an ending shared by passes 1 and 2', () => {
    const start = (num: string) => `<barline location="left"><ending number="${num}" type="start"/></barline>`
    const stop = (num: string) => `<barline location="right"><ending number="${num}" type="stop"/><repeat direction="backward" times="3"/></barline>`
    const t = parseScore(
      score([
        bar('C'),
        start('1, 2') + bar('D') + stop('1, 2'),
        `<barline location="left"><ending number="3" type="start"/></barline>${bar('E')}<barline location="right"><ending number="3" type="discontinue"/></barline>`,
      ]),
    )
    expect(t.measures.map((m) => m.sourceIndex)).toEqual([0, 1, 0, 1, 0, 2])
  })
})

describe('sticking and playing techniques', () => {
  it('reads sticking from <fingering>', () => {
    const f = (h: string) => `<notations><technical><fingering>${h}</fingering></technical></notations>`
    const t = parseScore(score([n('C', 5, 8, f('R')) + n('C', 5, 8, f('L'))]))
    expect(t.events.map((e) => e.sticking)).toEqual(['R', 'L'])
  })

  it('reads sticking from a text direction before the note', () => {
    const words = (w: string) => `<direction placement="below"><direction-type><words>${w}</words></direction-type></direction>`
    const t = parseScore(score([words('L') + n('C', 5, 8) + n('C', 5, 8)]))
    expect(t.events.map((e) => e.sticking)).toEqual(['L', null])
  })

  it('treats "lR" (flam sticking) as a right-hand main stroke', () => {
    const lyric = '<lyric><text>lR</text></lyric>'
    expect(parseScore(score([n('C', 5, 16, lyric)])).events[0].sticking).toBe('R')
  })

  it('ignores lyrics that are not sticking', () => {
    const lyric = '<lyric><text>Boom</text></lyric>'
    expect(parseScore(score([n('C', 5, 16, lyric)])).events[0].sticking).toBe(null)
  })

  it('switches to the edge zone after "edge" text until "center"', () => {
    const words = (w: string) => `<direction><direction-type><words>${w}</words></direction-type></direction>`
    const t = parseScore(score([n('C', 5, 4) + words('Edge') + n('C', 5, 4) + n('C', 5, 4) + words('center') + n('C', 5, 4)]))
    expect(t.events.map((e) => e.voice)).toEqual(['snare', 'snareEdge', 'snareEdge', 'snare'])
  })

  it('marks ghost notes (parenthesised noteheads) as soft', () => {
    const ghost = `<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
      <duration>16</duration><voice>1</voice><notehead parentheses="yes">normal</notehead></note>`
    const [e] = parseScore(score([ghost])).events
    expect(e.ghost).toBe(true)
    expect(e.velocity).toBeLessThan(0.5)
  })

  it('opens a hi-hat marked with an "o" (technical open)', () => {
    const open = '<notations><technical><open/></technical></notations>'
    const t = parseScore(score([n('G', 5, 8, open, 'x') + n('G', 5, 8, '', 'x')]))
    expect(t.events.map((e) => e.voice)).toEqual(['hihatOpen', 'hihatClosed'])
  })

  it('accepts strong accents (marcato) as accents', () => {
    const marc = '<notations><articulations><strong-accent/></articulations></notations>'
    expect(parseScore(score([n('C', 5, 16, marc)])).events[0].accent).toBe(true)
  })
})

describe('one-line staves', () => {
  const attrs = `<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details></attributes>`

  it('judges notes relative to the line, whatever pitch the exporter used for it', () => {
    // Exporter put "the line" at C5: clicks above it, rim shots (x) on it.
    const xml = score([n('C', 5, 4) + n('C', 5, 4) + n('E', 5, 4, '', 'x') + n('C', 5, 4, '', 'x')], { attributes: attrs })
    const t = parseScore(xml)
    expect(t.events.map((e) => e.voice)).toEqual(['snare', 'snare', 'stickClick', 'snareRim'])
    expect(t.suggestedMode).toBe('marching')
  })
})

describe('robustness', () => {
  it('reports a score without a drum part', () => {
    const xml = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`
    const t = parseScore(xml)
    expect(t.events).toEqual([])
    expect(t.warnings[0]).toMatch(/No drum/)
  })

  it('rejects non-MusicXML', () => {
    expect(() => parseScore('<html></html>')).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { eventsInRange, groupByBeat, indexAtBeat, measureIndexAtBeat } from './timeline'
import { parseScore } from './parseScore'
import rockBeatXml from '../samples/rock-beat.musicxml?raw'

const rock = parseScore(rockBeatXml)

describe('timeline helpers', () => {
  it('groups simultaneous hits together', () => {
    const groups = groupByBeat(rock.events)
    expect(groups[0].beat).toBe(0)
    expect(groups[0].events.map((e) => e.voice).sort()).toEqual(['hihatClosed', 'kick'])
    expect(groups[1].beat).toBe(0.5)
    // 8 groove bars x 8 eighth notes (the extra kick on the "and" of 3 lands
    // on a hi-hat 8th, so it joins that group), plus the final crash.
    expect(groups.length).toBe(8 * 8 + 1)
  })

  it('finds the last item at or before a beat', () => {
    const items = [{ beat: 0 }, { beat: 1 }, { beat: 1.5 }, { beat: 3 }]
    expect(indexAtBeat(items, -0.5)).toBe(-1)
    expect(indexAtBeat(items, 0)).toBe(0)
    expect(indexAtBeat(items, 1.2)).toBe(1)
    expect(indexAtBeat(items, 1.5)).toBe(2)
    expect(indexAtBeat(items, 99)).toBe(3)
  })

  it('selects events in a half-open beat range', () => {
    expect(eventsInRange(rock.events, 0, 1).map((e) => e.beat)).toEqual([0.5, 1, 1])
  })

  it('finds the measure for a beat', () => {
    expect(measureIndexAtBeat(rock, 0)).toBe(0)
    expect(measureIndexAtBeat(rock, 4)).toBe(1)
    expect(measureIndexAtBeat(rock, 35.9)).toBe(8)
  })
})

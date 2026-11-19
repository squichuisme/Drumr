import { describe, expect, it } from 'vitest'
import { parseScore } from '../core/parseScore'
import { clickUnitBeats, planSession, PPQ, ticksToScoreBeat, ticksToSeconds, type ScheduleItem } from './schedule'
import driftXml from '../samples/drift-check-32-bars.musicxml?raw'
import rockXml from '../samples/rock-beat.musicxml?raw'
import jazzTimeXml from '../samples/jazz-time.musicxml?raw'
import jazzFillsXml from '../samples/jazz-triplet-fills.musicxml?raw'
import { makeSwingWarp } from './schedule'

const drift = parseScore(driftXml)
// Cursor steps at every distinct hit beat (what OSMD produces for these samples).
const stepsFor = (beats: number[]) => [...new Set(beats)].sort((a, b) => a - b)
const driftSteps = stepsFor(drift.events.map((e) => e.beat))

const of = <K extends ScheduleItem['kind']>(items: ScheduleItem[], kind: K) =>
  items.filter((i): i is Extract<ScheduleItem, { kind: K }> => i.kind === kind)

describe('session planning', () => {
  it('puts every cursor step on exactly the same tick as the hits under it', () => {
    const plan = planSession(drift, driftSteps, { startBeat: 0, loop: null, countIn: true })
    const hitTicks = new Map(of(plan.items, 'hits').map((h) => [ticksToScoreBeat(plan, h.ticks), h.ticks]))
    for (const step of of(plan.items, 'step')) {
      const beat = driftSteps[step.stepIndex]
      expect(step.ticks).toBe(hitTicks.get(beat))
    }
  })

  it('has no drift: bar 32 at 160 BPM lands at exactly 46.5 s (plus the count-in)', () => {
    const bpm = 160
    const plan = planSession(drift, driftSteps, { startBeat: 0, loop: null, countIn: true })
    const bar32Beat = drift.measures[31].startBeat // 124
    const hits = of(plan.items, 'hits').find((h) => ticksToScoreBeat(plan, h.ticks) === bar32Beat)!
    const step = of(plan.items, 'step').find((s) => driftSteps[s.stepIndex] === bar32Beat)!
    const countIn = (4 * 60) / bpm // one 4/4 bar = 1.5 s
    expect(ticksToSeconds(hits.ticks, bpm)).toBe(countIn + 46.5)
    expect(ticksToSeconds(step.ticks, bpm)).toBe(countIn + 46.5)
    // Every single hit is exactly where the tempo says it should be.
    for (const h of of(plan.items, 'hits')) {
      const beat = ticksToScoreBeat(plan, h.ticks)
      expect(ticksToSeconds(h.ticks, bpm)).toBeCloseTo(countIn + (beat * 60) / bpm, 9)
    }
  })

  it('counts in one bar of quarter clicks with the downbeat accented', () => {
    const plan = planSession(drift, driftSteps, { startBeat: 0, loop: null, countIn: true })
    const countIn = of(plan.items, 'click').filter((c) => c.countIn)
    expect(countIn.map((c) => c.ticks)).toEqual([0, PPQ, 2 * PPQ, 3 * PPQ])
    expect(countIn.map((c) => c.accent)).toEqual([true, false, false, false])
    expect(of(plan.items, 'countInEnd')[0].ticks).toBe(4 * PPQ)
    expect(plan.leadInBeats).toBe(4)
  })

  it('starts the music at tick 0 without a count-in', () => {
    const plan = planSession(drift, driftSteps, { startBeat: 0, loop: null, countIn: false })
    expect(plan.items[0].ticks).toBe(0)
    expect(of(plan.items, 'click').every((c) => !c.countIn)).toBe(true)
  })

  it('starts mid-score: only later events, count-in right before', () => {
    const plan = planSession(drift, driftSteps, { startBeat: 16, loop: null, countIn: true })
    const firstHit = of(plan.items, 'hits')[0]
    expect(firstHit.ticks).toBe(4 * PPQ)
    expect(ticksToScoreBeat(plan, firstHit.ticks)).toBe(16)
    expect(of(plan.items, 'hits').every((h) => ticksToScoreBeat(plan, h.ticks) >= 16)).toBe(true)
  })

  it('schedules a metronome click on every beat, accenting downbeats', () => {
    const plan = planSession(drift, driftSteps, { startBeat: 0, loop: null, countIn: false })
    const clicks = of(plan.items, 'click')
    expect(clicks).toHaveLength(32 * 4)
    expect(clicks.filter((c) => c.accent)).toHaveLength(32)
  })

  it('sets transport loop points for a measure range and never ends', () => {
    const plan = planSession(drift, driftSteps, { startBeat: 0, loop: { startBeat: 8, endBeat: 16 }, countIn: true })
    expect(plan.loop).toEqual({ startTicks: 4 * PPQ, endTicks: 12 * PPQ })
    expect(of(plan.items, 'end')).toHaveLength(0)
    const hitBeats = of(plan.items, 'hits').map((h) => ticksToScoreBeat(plan, h.ticks))
    expect(Math.min(...hitBeats)).toBe(8)
    expect(Math.max(...hitBeats)).toBe(15.5)
  })

  it('ends after the last bar when not looping', () => {
    const rock = parseScore(rockXml)
    const plan = planSession(rock, [], { startBeat: 0, loop: null, countIn: false })
    const end = of(plan.items, 'end')[0]
    expect(ticksToScoreBeat(plan, end.ticks)).toBe(36)
  })
})

describe('metronome click unit', () => {
  it('clicks quarters in 4/4, halves in 2/2, dotted quarters in 6/8 and 12/8', () => {
    expect(clickUnitBeats({ beats: 4, beatType: 4 })).toBe(1)
    expect(clickUnitBeats({ beats: 2, beatType: 2 })).toBe(2)
    expect(clickUnitBeats({ beats: 6, beatType: 8 })).toBe(1.5)
    expect(clickUnitBeats({ beats: 12, beatType: 8 })).toBe(1.5)
    expect(clickUnitBeats({ beats: 3, beatType: 8 })).toBe(0.5)
  })
})

describe('swing playback', () => {
  const jazz = parseScore(jazzTimeXml)
  const jazzSteps = stepsFor(jazz.events.map((e) => e.beat))
  const hitTicksAt = (plan: ReturnType<typeof planSession>, writtenBeat: number) => {
    const groups = of(plan.items, 'hits')
    const target = groups.find((h) => h.events[0].beat === writtenBeat)
    return target?.ticks
  }

  it('plays the "and" of 2 on the last triplet of the beat, cursor included', () => {
    const plan = planSession(jazz, jazzSteps, { startBeat: 0, loop: null, countIn: false })
    // Written at beat 1.5 (straight), played at 1 + 2/3.
    expect(hitTicksAt(plan, 1.5)).toBe(Math.round((1 + 2 / 3) * PPQ))
    const step = of(plan.items, 'step').find((s) => jazzSteps[s.stepIndex] === 1.5)!
    expect(step.ticks).toBe(hitTicksAt(plan, 1.5))
    // Downbeats don't move.
    expect(hitTicksAt(plan, 1)).toBe(PPQ)
    expect(hitTicksAt(plan, 2)).toBe(2 * PPQ)
  })

  it('leaves metronome clicks on the beat', () => {
    const plan = planSession(jazz, jazzSteps, { startBeat: 0, loop: null, countIn: false })
    expect(of(plan.items, 'click').every((c) => c.ticks % PPQ === 0)).toBe(true)
  })

  it('can be forced straight, or harder, from the swing control', () => {
    const straight = planSession(jazz, jazzSteps, { startBeat: 0, loop: null, countIn: false, swing: 0.5 })
    expect(hitTicksAt(straight, 1.5)).toBe(1.5 * PPQ)
    const hard = planSession(jazz, jazzSteps, { startBeat: 0, loop: null, countIn: false, swing: 0.75 })
    expect(hitTicksAt(hard, 1.5)).toBe(1.75 * PPQ)
  })

  it('can swing a straight score (e.g. practise a shuffle on the rock beat)', () => {
    const rock = parseScore(rockXml)
    const plan = planSession(rock, [], { startBeat: 0, loop: null, countIn: false, swing: 2 / 3 })
    expect(hitTicksAt(plan, 0.5)).toBe(Math.round((2 / 3) * PPQ))
  })

  it('does not swing triplets', () => {
    const fills = parseScore(jazzFillsXml)
    const warp = makeSwingWarp(fills)
    expect(fills.measures[3].swing).not.toBeNull()
    for (const k of [0, 1, 2, 3, 4, 5]) expect(warp(12 + k / 3)).toBeCloseTo(12 + k / 3, 9)
  })

  it('moves a flam into the "and" together with its main note', () => {
    const warp = makeSwingWarp(jazz)
    expect(warp(1.5 - 0.06, true)).toBeCloseTo(1 + 2 / 3 - 0.06, 9)
    expect(warp(1.5 - 0.06, false)).toBeCloseTo(1.44, 9) // a real note there isn't a flam
  })

  it('swings 16th pairs when the score says swing-type 16th', () => {
    const t = { ...jazz, measures: jazz.measures.map((m) => ({ ...m, swing: { ratio: 2 / 3, unit: '16th' as const } })) }
    const warp = makeSwingWarp(t)
    expect(warp(0.25)).toBeCloseTo(1 / 3, 9)
    expect(warp(0.5)).toBe(0.5)
    expect(warp(0.75)).toBeCloseTo(0.5 + 1 / 3, 9)
  })
})

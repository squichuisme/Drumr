import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { PlaybackEngine, type PlayState, type TrainerSettings } from '../audio/PlaybackEngine'
import type { LoopRange, SwingSetting } from '../audio/schedule'
import type { ScoreLayout, ScoreViewHandle } from '../components/ScoreView'
import { keepInView } from '../core/autoScroll'
import { hitBus } from '../core/hitBus'
import { createStore } from '../core/store'
import { eventsInRange } from '../core/timeline'
import type { ScoreTimeline, Voice } from '../core/types'

export const MIN_BPM = 40
export const MAX_BPM = 200
const clampBpm = (bpm: number) => Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)))

/** A loop chosen by clicking measures: written measure indices (inclusive, either order). */
export interface LoopSelection {
  startSource: number
  endSource: number
}

interface UsePlaybackArgs {
  timeline: ScoreTimeline | null
  layout: ScoreLayout
  scoreRef: RefObject<ScoreViewHandle | null>
}

const DEFAULT_TRAINER: TrainerSettings = { enabled: false, stepBpm: 5, everyLoops: 2, maxBpm: 160 }

/**
 * Owns the PlaybackEngine and all playback/practice settings, and connects
 * the engine's callbacks to the cursor, stores and React state.
 */
export function usePlayback({ timeline, layout, scoreRef }: UsePlaybackArgs) {
  const [engine] = useState(() => new PlaybackEngine())

  // Fast-changing values live in stores (see src/core/store.ts).
  const [stores] = useState(() => ({
    step: createStore(-1),
    countIn: createStore<number | null>(null),
    loopPasses: createStore(0),
  }))

  const [playState, setPlayState] = useState<PlayState>('stopped')
  const [tempo, setTempoState] = useState(() => clampBpm(timeline?.tempo ?? 100))
  const [metronome, setMetronomeState] = useState(false)
  const [countIn, setCountInState] = useState(true)
  const [playAlong, setPlayAlongState] = useState(false)
  const [loop, setLoop] = useState<LoopSelection | null>(null)
  const [trainer, setTrainerState] = useState<TrainerSettings>(DEFAULT_TRAINER)
  const [swing, setSwingState] = useState<SwingSetting>('score')

  // A new score resets tempo and loop. React's recommended way to reset state
  // when an input changes is to compare with the previous value during render.
  const [loadedTimeline, setLoadedTimeline] = useState(timeline)
  if (timeline !== loadedTimeline) {
    setLoadedTimeline(timeline)
    setTempoState(clampBpm(timeline?.tempo ?? 100))
    setLoop(null)
    setSwingState('score')
  }

  // The latest cursor steps, readable from callbacks without re-subscribing.
  const stepsRef = useRef(layout.steps)
  useEffect(() => {
    stepsRef.current = layout.steps
  }, [layout])

  const moveCursor = useCallback(
    (i: number) => {
      stores.step.set(i)
      if (i >= 0) {
        scoreRef.current?.showCursorAt(i)
        // Auto-scroll to follow the music. On the last note of a line, also
        // bring the next line into view so the cursor never jumps off-screen.
        const steps = stepsRef.current
        const here = steps[i]
        const next = steps[i + 1]
        const newLine = here && next && Math.abs(next.y - here.y) > 4
        keepInView(scoreRef.current?.cursorElement() ?? null, newLine ? next.y - here.y : 0, newLine ? next.height : 0)
      } else {
        scoreRef.current?.hideCursor()
      }
    },
    [stores, scoreRef],
  )
  const stepIndexAtOrAfter = useCallback((beat: number) => stepsRef.current.findIndex((s) => s.beat >= beat - 1e-6), [])

  // Engine → UI.
  useEffect(() => {
    engine.setListeners({
      onStep: moveCursor,
      onState: setPlayState,
      onCountIn: (c) => stores.countIn.set(c),
      onTempo: (bpm) => setTempoState(bpm),
      onLoopPass: (n) => stores.loopPasses.set(n),
    })
  }, [engine, moveCursor, stores])

  // New score → load it into the engine (an external system, so an effect).
  useEffect(() => {
    if (!timeline) return
    engine.load(timeline)
    engine.setTempo(clampBpm(timeline.tempo))
    void engine.setSwing('score')
    stores.step.set(-1)
    stores.loopPasses.set(0)
  }, [engine, timeline, stores])

  // Fresh cursor positions (after load or resize): keep the cursor where it was.
  useEffect(() => {
    engine.setSteps(layout.steps.map((s) => s.beat))
    const i = stores.step.get()
    if (i >= 0 && i < layout.steps.length) scoreRef.current?.showCursorAt(i)
  }, [engine, layout, stores, scoreRef])

  // Stop audio when the page goes away.
  useEffect(() => () => engine.stop(), [engine])

  // --- Loop: written measures → a beat range in playback order. ------------
  const selectedRange = useMemo((): LoopRange | null => {
    if (!loop || !timeline) return null
    const a = Math.min(loop.startSource, loop.endSource)
    const b = Math.max(loop.startSource, loop.endSource)
    // First time the start measure is played, then the first time the end
    // measure is played after that (repeats can make measures appear twice).
    const first = timeline.measures.find((m) => m.sourceIndex === a)
    if (!first) return null
    const last = timeline.measures.find((m) => m.index >= first.index && m.sourceIndex === b) ?? first
    return { startBeat: first.startBeat, endBeat: last.startBeat + last.lengthBeats }
  }, [loop, timeline])

  // The speed trainer needs something to loop: without a selection, loop the whole score.
  const loopRange = useMemo((): LoopRange | null => {
    if (selectedRange) return selectedRange
    if (trainer.enabled && timeline && timeline.totalBeats > 0) return { startBeat: 0, endBeat: timeline.totalBeats }
    return null
  }, [selectedRange, trainer.enabled, timeline])

  useEffect(() => {
    void engine.setLoop(loopRange)
    stores.loopPasses.set(0)
    if (loopRange && engine.getState() === 'stopped') {
      const i = stepIndexAtOrAfter(loopRange.startBeat)
      if (i >= 0) moveCursor(i)
    }
  }, [engine, loopRange, stores, moveCursor, stepIndexAtOrAfter])

  // --- Transport actions ---------------------------------------------------
  const playPause = useCallback(() => {
    if (engine.getState() === 'playing') engine.pause()
    else void engine.play()
  }, [engine])

  const stop = useCallback(() => engine.stop(), [engine])

  const rewind = useCallback(() => {
    const beat = loopRange?.startBeat ?? 0
    engine.seek(beat)
    moveCursor(stepIndexAtOrAfter(beat))
  }, [engine, loopRange, moveCursor, stepIndexAtOrAfter])

  /** Start from a written measure (used when clicking a measure while stopped). */
  const startFromMeasure = useCallback(
    (sourceIndex: number) => {
      const m = timeline?.measures.find((x) => x.sourceIndex === sourceIndex)
      if (!m || engine.getState() === 'playing') return
      engine.seek(m.startBeat)
      moveCursor(stepIndexAtOrAfter(m.startBeat))
    },
    [engine, timeline, moveCursor, stepIndexAtOrAfter],
  )

  /** Step the cursor by hand (when not playing) and light what's under it. */
  const goToStep = useCallback(
    (target: number) => {
      const steps = stepsRef.current
      if (!timeline || steps.length === 0 || engine.getState() === 'playing') return
      const i = Math.min(Math.max(target, 0), steps.length - 1)
      engine.seek(steps[i].beat)
      moveCursor(i)
      const from = i > 0 ? steps[i - 1].beat : -Infinity
      hitBus.emit(eventsInRange(timeline.events, from, steps[i].beat))
    },
    [engine, timeline, moveCursor],
  )

  // --- Settings: applied to the engine immediately, mirrored in React state.
  const setTempo = useCallback(
    (bpm: number) => {
      const v = clampBpm(bpm)
      engine.setTempo(v)
      setTempoState(v)
    },
    [engine],
  )
  const setMetronome = useCallback(
    (on: boolean) => {
      engine.setMetronome(on)
      setMetronomeState(on)
    },
    [engine],
  )
  const setCountIn = useCallback(
    (on: boolean) => {
      engine.setCountIn(on)
      setCountInState(on)
    },
    [engine],
  )
  const setSwing = useCallback(
    (value: SwingSetting) => {
      void engine.setSwing(value)
      setSwingState(value)
    },
    [engine],
  )
  const setTrainer = useCallback(
    (t: TrainerSettings) => {
      engine.setTrainer(t)
      setTrainerState(t)
    },
    [engine],
  )

  /**
   * Play-along mode: mute the drums but keep the metronome (switched on for
   * you) — the lights still show what to play. Turning it off restores the
   * metronome setting you had before.
   */
  const metronomeBeforePlayAlong = useRef(false)
  const setPlayAlong = useCallback(
    (on: boolean) => {
      engine.setMuteDrums(on)
      setPlayAlongState(on)
      if (on) {
        metronomeBeforePlayAlong.current = metronome
        setMetronome(true)
      } else {
        setMetronome(metronomeBeforePlayAlong.current)
      }
    },
    [engine, metronome, setMetronome],
  )

  const audition = useCallback(
    (voice: Voice) => {
      void engine.audition(voice)
      hitBus.emit([
        { beat: 0, durationBeats: 0, voice, accent: false, ghost: false, grace: false, velocity: 0.85, sticking: null, measureIndex: 0, sourceMeasureIndex: 0 },
      ])
    },
    [engine],
  )

  return {
    engine,
    stores,
    playState,
    tempo,
    setTempo,
    metronome,
    setMetronome,
    countIn,
    setCountIn,
    playAlong,
    setPlayAlong,
    loop,
    setLoop,
    loopRange,
    /** True when the trainer is looping the whole score because no loop is selected. */
    loopingWholeScore: !selectedRange && !!loopRange,
    trainer,
    setTrainer,
    swing,
    setSwing,
    playPause,
    stop,
    rewind,
    goToStep,
    startFromMeasure,
    audition,
  }
}

export type Playback = ReturnType<typeof usePlayback>

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { PlaybackEngine, type PlayState, type TrainerSettings } from '../audio/PlaybackEngine'
import type { LoopRange } from '../audio/schedule'
import type { ScoreLayout, ScoreViewHandle } from '../components/ScoreView'
import { hitBus } from '../core/hitBus'
import { createStore } from '../core/store'
import { eventsInRange } from '../core/timeline'
import type { ScoreTimeline, Voice } from '../core/types'

export const MIN_BPM = 40
export const MAX_BPM = 200
const clampBpm = (bpm: number) => Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)))

/** A loop chosen by clicking measures: written measure indices (inclusive). */
export interface LoopSelection {
  startSource: number
  endSource: number
}

interface UsePlaybackArgs {
  timeline: ScoreTimeline | null
  layout: ScoreLayout
  scoreRef: RefObject<ScoreViewHandle | null>
}

/**
 * Owns the PlaybackEngine and all playback settings, and connects the
 * engine's callbacks to the cursor, stores and React state.
 */
export function usePlayback({ timeline, layout, scoreRef }: UsePlaybackArgs) {
  const engineRef = useRef<PlaybackEngine | null>(null)
  engineRef.current ??= new PlaybackEngine()
  const engine = engineRef.current

  // Fast-changing values live in stores (see src/core/store.ts).
  const stores = useMemo(
    () => ({
      step: createStore(-1),
      countIn: createStore<number | null>(null),
      loopPasses: createStore(0),
    }),
    [],
  )

  const [playState, setPlayState] = useState<PlayState>('stopped')
  const [tempo, setTempoState] = useState(100)
  const [metronome, setMetronomeState] = useState(false)
  const [countIn, setCountInState] = useState(true)
  const [muteDrums, setMuteDrumsState] = useState(false)
  const [loop, setLoopState] = useState<LoopSelection | null>(null)
  const [trainer, setTrainerState] = useState<TrainerSettings>({ enabled: false, stepBpm: 5, everyLoops: 2, maxBpm: 160 })

  const moveCursor = useCallback(
    (i: number) => {
      stores.step.set(i)
      if (i >= 0) scoreRef.current?.showCursorAt(i)
      else scoreRef.current?.hideCursor()
    },
    [stores, scoreRef],
  )

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

  // New score: load it, adopt its tempo, clear the loop.
  useEffect(() => {
    if (!timeline) return
    engine.load(timeline)
    const bpm = clampBpm(timeline.tempo)
    engine.setTempo(bpm)
    setTempoState(bpm)
    setLoopState(null)
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

  // --- Loop: convert written measures to a beat range in playback order. ---
  const loopRange = useMemo((): LoopRange | null => {
    if (!loop || !timeline) return null
    const a = Math.min(loop.startSource, loop.endSource)
    const b = Math.max(loop.startSource, loop.endSource)
    const first = timeline.measures.find((m) => m.sourceIndex === a)
    if (!first) return null
    const last = timeline.measures.find((m) => m.index >= first.index && m.sourceIndex === b) ?? first
    return { startBeat: first.startBeat, endBeat: last.startBeat + last.lengthBeats }
  }, [loop, timeline])

  useEffect(() => {
    void engine.setLoop(loopRange)
    stores.loopPasses.set(0)
    if (loopRange && engine.getState() === 'stopped') {
      // Show where the loop will start.
      const i = layout.steps.findIndex((s) => s.beat >= loopRange.startBeat - 1e-6)
      if (i >= 0) moveCursor(i)
    }
    // `layout` is only read to place the cursor, so a resize needn't re-run this.
  }, [engine, loopRange, stores, moveCursor])

  // --- Actions ------------------------------------------------------------
  const playPause = useCallback(() => {
    if (engine.getState() === 'playing') engine.pause()
    else void engine.play()
  }, [engine])

  const stop = useCallback(() => engine.stop(), [engine])

  const rewind = useCallback(() => {
    const beat = loopRange?.startBeat ?? 0
    engine.seek(beat)
    const i = layout.steps.findIndex((s) => s.beat >= beat - 1e-6)
    moveCursor(i)
  }, [engine, loopRange, layout, moveCursor])

  /** Step the cursor by hand (when not playing) and light what's under it. */
  const goToStep = useCallback(
    (target: number) => {
      const steps = layout.steps
      if (!timeline || steps.length === 0 || engine.getState() === 'playing') return
      const i = Math.min(Math.max(target, 0), steps.length - 1)
      engine.seek(steps[i].beat)
      moveCursor(i)
      const from = i > 0 ? steps[i - 1].beat : -Infinity
      hitBus.emit(eventsInRange(timeline.events, from, steps[i].beat))
    },
    [engine, layout, timeline, moveCursor],
  )

  const setTempo = useCallback(
    (bpm: number) => {
      const v = clampBpm(bpm)
      engine.setTempo(v)
      setTempoState(v)
    },
    [engine],
  )
  // Each setting is applied to the engine immediately and mirrored in React state for the UI.
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
  const setMuteDrums = useCallback(
    (on: boolean) => {
      engine.setMuteDrums(on)
      setMuteDrumsState(on)
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
    muteDrums,
    setMuteDrums,
    loop,
    setLoop: setLoopState,
    loopRange,
    trainer,
    setTrainer,
    playPause,
    stop,
    rewind,
    goToStep,
    audition,
  }
}

export type Playback = ReturnType<typeof usePlayback>

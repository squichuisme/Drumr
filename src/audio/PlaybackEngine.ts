/**
 * Plays a ScoreTimeline with Tone.js and keeps the cursor and diagram lights
 * locked to the sound.
 *
 * The rule that keeps everything in sync: NOTHING uses setTimeout or
 * setInterval. Every sound, light and cursor move is an event on
 * Tone.Transport (see schedule.ts). When the Transport fires an event it
 * hands us the exact audio-clock `time` the event should sound at:
 *   - sounds are started at that `time` (sample-accurate),
 *   - visuals go through Tone.Draw.schedule(callback, time), which runs the
 *     callback on the animation frame closest to when that `time` is heard.
 * Tempo changes (slider, speed trainer) change how fast the Transport's
 * ticks advance, but the ticks themselves never change, so sync holds.
 */
import * as Tone from 'tone'
import { hitBus } from '../core/hitBus'
import { indexAtBeat } from '../core/timeline'
import type { ScoreTimeline, Voice } from '../core/types'
import { DrumKit } from './drumKit'
import { Metronome } from './metronome'
import { planSession, PPQ, ticksToScoreBeat, type LoopRange, type ScheduleItem, type SessionPlan, type SwingSetting } from './schedule'

export type PlayState = 'stopped' | 'playing' | 'paused'

export interface TrainerSettings {
  enabled: boolean
  /** Add this many BPM ... */
  stepBpm: number
  /** ... after every this many loops ... */
  everyLoops: number
  /** ... up to this tempo. */
  maxBpm: number
}

export interface EngineListeners {
  /** The cursor should move to this step (index into the score's cursor steps). */
  onStep?: (stepIndex: number) => void
  onState?: (state: PlayState) => void
  /** Count-in number (1, 2, 3, 4 …) while counting in; null when the music starts. */
  onCountIn?: (count: number | null) => void
  /** The speed trainer changed the tempo. */
  onTempo?: (bpm: number) => void
  /** A loop pass finished (1 = first time round done). */
  onLoopPass?: (passes: number) => void
}

/** Timing info for each cursor move, used by the drift check (dev only). */
export interface StepTiming {
  stepIndex: number
  ticks: number
  /** Audio-clock time the step's notes sound at. */
  scheduledTime: number
  /** Audio-clock time when the cursor actually moved on screen. */
  drawnAt: number
}

export class PlaybackEngine {
  private readonly transport = Tone.getTransport()
  private readonly draw = Tone.getDraw()
  private kit: DrumKit | null = null
  private metronome: Metronome | null = null
  private master: Tone.WaveShaper | null = null

  private timeline: ScoreTimeline | null = null
  private steps: { beat: number }[] = []
  private plan: SessionPlan | null = null
  private state: PlayState = 'stopped'
  /** Where the next "play" starts from when stopped (score beats). */
  private startBeat = 0
  private loopPasses = 0

  private tempo = 100
  private metronomeOn = false
  private countIn = true
  private muteDrums = false
  private loop: LoopRange | null = null
  private swing: SwingSetting = 'score'
  private trainer: TrainerSettings = { enabled: false, stepBpm: 5, everyLoops: 2, maxBpm: 160 }

  /** Dev hook: called for every cursor move with its timing (see the drift check). */
  onStepTiming: ((t: StepTiming) => void) | null = null

  private listeners: EngineListeners = {}

  constructor() {
    this.transport.PPQ = PPQ
    this.transport.on('loop', (time: number) => this.handleLoopWrap(time))
  }

  setListeners(listeners: EngineListeners): void {
    this.listeners = listeners
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  load(timeline: ScoreTimeline): void {
    this.hardStop()
    this.timeline = timeline
    this.startBeat = 0
    this.loop = null
  }

  /** Cursor step beats from the rendered score (OSMD). Same score → same beats. */
  setSteps(stepBeats: readonly number[]): void {
    this.steps = stepBeats.map((beat) => ({ beat }))
  }

  // -------------------------------------------------------------------------
  // Transport controls
  // -------------------------------------------------------------------------

  getState(): PlayState {
    return this.state
  }

  async play(): Promise<void> {
    if (!this.timeline || this.state === 'playing') return
    await this.ensureAudio()
    if (this.state === 'paused' && this.plan) {
      this.transport.start()
      this.setState('playing')
      return
    }
    this.scheduleSession()
    this.transport.start(Tone.now() + 0.05, 0)
    this.setState('playing')
  }

  pause(): void {
    if (this.state !== 'playing') return
    this.transport.pause()
    this.setState('paused')
  }

  /** Stop and return the cursor to where playback started. */
  stop(): void {
    this.hardStop()
    this.showStepAt(this.loop ? this.loop.startBeat : this.startBeat)
  }

  /** Choose where the next play starts (stops playback if it was running). */
  seek(beat: number): void {
    this.hardStop()
    this.startBeat = Math.max(0, beat)
  }

  /** Current score position, read from the Transport (for jumps like "clear loop"). */
  currentBeat(): number {
    if (!this.plan || this.state === 'stopped') return this.startBeat
    const ticks = this.transport.getTicksAtTime(Tone.getContext().currentTime)
    return Math.max(0, ticksToScoreBeat(this.plan, ticks))
  }

  // -------------------------------------------------------------------------
  // Settings (all safe to change while playing)
  // -------------------------------------------------------------------------

  setTempo(bpm: number): void {
    this.tempo = bpm
    this.transport.bpm.value = bpm
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on
    this.metronome?.setEnabled(on)
  }

  setCountIn(on: boolean): void {
    this.countIn = on // takes effect on the next play
  }

  setMuteDrums(muted: boolean): void {
    this.muteDrums = muted
    this.kit?.setMuted(muted)
  }

  setTrainer(trainer: TrainerSettings): void {
    this.trainer = trainer
  }

  /** Change the swing feel. While playing, playback picks up again from the current bar. */
  async setSwing(swing: SwingSetting): Promise<void> {
    if (swing === this.swing) return
    this.swing = swing
    if (this.state === 'stopped' || !this.timeline) return
    const wasPlaying = this.state === 'playing'
    const resumeAt = this.loop ? this.loop.startBeat : this.measureStartAt(this.currentBeat())
    this.hardStop()
    this.startBeat = resumeAt
    if (wasPlaying) await this.play()
  }

  /** Set or clear the loop. While playing, playback restarts at the loop (or carries on from the current bar). */
  async setLoop(loop: LoopRange | null): Promise<void> {
    const wasPlaying = this.state === 'playing'
    const resumeAt = this.timeline ? this.measureStartAt(this.currentBeat()) : 0
    this.loop = loop
    if (this.state === 'stopped') {
      if (loop) this.startBeat = loop.startBeat
      return
    }
    this.hardStop()
    this.startBeat = loop ? loop.startBeat : resumeAt
    if (wasPlaying) await this.play()
  }

  /** Dev/test only: the Tone context and master output, to measure what is really rendered. */
  debugAudio() {
    return { context: Tone.getContext(), destination: Tone.getDestination() }
  }

  /** Tap a drum on the diagram: play it right now. */
  async audition(voice: Voice): Promise<void> {
    await this.ensureAudio()
    this.kit!.trigger(voice, Tone.now() + 0.01, 0.85)
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Audio can only start after a user gesture, so build the synths lazily. */
  private async ensureAudio(): Promise<void> {
    await Tone.start()
    if (this.kit) return
    // Master "safety" stage: a soft clipper that leaves normal levels alone
    // and only rounds off peaks near full scale. We deliberately don't use
    // Tone.Limiter/Compressor here: Web Audio's compressor looks ahead ~6 ms,
    // which delays ALL audio and puts the sound behind the lights (the drift
    // check in scripts/drift-check.cjs caught exactly that).
    this.master = new Tone.WaveShaper((x) => {
      const knee = 0.8
      const a = Math.abs(x)
      return a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)))
    }, 4096).toDestination()
    this.kit = new DrumKit(this.master)
    this.metronome = new Metronome(this.master)
    this.kit.setMuted(this.muteDrums)
    this.metronome.setEnabled(this.metronomeOn)
  }

  /** Build this session's plan and put every item on the Transport. */
  private scheduleSession(): void {
    const timeline = this.timeline!
    this.transport.stop()
    this.transport.cancel(0)
    this.plan = planSession(
      timeline,
      this.steps.map((s) => s.beat),
      { startBeat: this.startBeat, loop: this.loop, countIn: this.countIn, swing: this.swing },
    )
    this.transport.bpm.value = this.tempo
    this.loopPasses = 0
    for (const item of this.plan.items) {
      this.transport.schedule((time) => this.fire(item, time), `${item.ticks}i`)
    }
    if (this.plan.loop) {
      this.transport.setLoopPoints(`${this.plan.loop.startTicks}i`, `${this.plan.loop.endTicks}i`)
      this.transport.loop = true
    } else {
      this.transport.loop = false
    }
    this.showStepAt(this.plan.startBeat)
  }

  /**
   * How long after its audio-clock time a sound actually leaves the speakers
   * (the browser's reported output latency — large on Bluetooth). Visuals are
   * delayed by the same amount so lights match what you HEAR.
   */
  private visualDelay(): number {
    const ctx = Tone.getContext().rawContext as AudioContext
    const latency = ctx.outputLatency || 0
    return Math.min(0.3, Math.max(0, latency))
  }

  /** Called by the Transport, slightly ahead of time, with the exact audio time to act at. */
  private fire(item: ScheduleItem, time: number): void {
    const seen = time + this.visualDelay()
    switch (item.kind) {
      case 'hits':
        for (const e of item.events) this.kit!.trigger(e.voice, time, e.velocity)
        this.draw.schedule(() => hitBus.emit(item.events), seen)
        break
      case 'click':
        this.metronome!.click(time, item.accent, item.countIn)
        if (item.countIn) this.draw.schedule(() => this.listeners.onCountIn?.(item.count ?? null), seen)
        break
      case 'countInEnd':
        this.draw.schedule(() => this.listeners.onCountIn?.(null), seen)
        break
      case 'step':
        this.draw.schedule(() => {
          this.listeners.onStep?.(item.stepIndex)
          this.onStepTiming?.({
            stepIndex: item.stepIndex,
            ticks: item.ticks,
            scheduledTime: time,
            drawnAt: Tone.getContext().currentTime - (seen - time),
          })
        }, seen)
        break
      case 'end':
        this.draw.schedule(() => this.stop(), seen)
        break
    }
  }

  private handleLoopWrap(time: number): void {
    this.loopPasses++
    const passes = this.loopPasses
    this.draw.schedule(() => this.listeners.onLoopPass?.(passes), time)
    const t = this.trainer
    if (t.enabled && passes % Math.max(1, t.everyLoops) === 0 && this.tempo < t.maxBpm) {
      const next = Math.min(t.maxBpm, this.tempo + t.stepBpm)
      this.tempo = next
      // Change tempo exactly at the loop boundary, on the audio clock.
      this.transport.bpm.setValueAtTime(next, time)
      this.draw.schedule(() => this.listeners.onTempo?.(next), time)
    }
  }

  private hardStop(): void {
    this.transport.stop()
    this.transport.cancel(0)
    this.draw.cancel(0)
    this.plan = null
    this.listeners.onCountIn?.(null)
    hitBus.reset()
    this.setState('stopped')
  }

  private showStepAt(beat: number): void {
    const i = indexAtBeat(this.steps, beat)
    if (i >= 0) this.listeners.onStep?.(i)
  }

  private measureStartAt(beat: number): number {
    const m = this.timeline?.measures.findLast((m) => m.startBeat <= beat + 1e-6)
    return m?.startBeat ?? 0
  }

  private setState(state: PlayState): void {
    if (this.state === state) return
    this.state = state
    this.listeners.onState?.(state)
  }
}

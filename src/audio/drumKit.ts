/**
 * A drum kit made entirely of Tone.js synthesizers, so no sample files are
 * needed:
 *   - MembraneSynth: a sine wave whose pitch drops fast → kick and toms
 *   - NoiseSynth:    filtered white noise → snare wires, rim cracks
 *   - MetalSynth:    clangy FM tones → hi-hats, cymbals, ride
 *
 * Each Voice from the parser maps to a small recipe below. Tweak the numbers
 * to taste — every recipe is independent.
 */
import * as Tone from 'tone'
import type { Voice } from '../core/types'

type Trigger = (time: number, velocity: number) => void

export class DrumKit {
  /** Everything goes through this gain so "mute drums" is one knob. */
  readonly output: Tone.Gain
  private triggers: Record<Voice, Trigger>
  private nodes: Tone.ToneAudioNode[] = []
  /** Last start time per voice: Tone's mono synths need strictly increasing times. */
  private lastTime = new Map<Voice, number>()

  constructor(destination: Tone.InputNode) {
    this.output = new Tone.Gain(1).connect(destination)
    this.triggers = this.buildKit()
  }

  /** Play a voice at an exact audio-clock time. velocity 0..1. */
  trigger(voice: Voice, time: number, velocity: number): void {
    // Two hits on the same synth at the same instant would throw, so nudge.
    const last = this.lastTime.get(voice) ?? -1
    const t = Math.max(time, last + 0.004)
    this.lastTime.set(voice, t)
    // Perceived loudness isn't linear; a gentle curve makes taps vs accents clearer.
    this.triggers[voice](t, Math.pow(Math.min(1, Math.max(0, velocity)), 1.4))
  }

  setMuted(muted: boolean): void {
    this.output.gain.rampTo(muted ? 0 : 1, 0.02)
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose()
    this.output.dispose()
  }

  private keep<T extends Tone.ToneAudioNode>(node: T): T {
    this.nodes.push(node)
    return node
  }

  private buildKit(): Record<Voice, Trigger> {
    const out = this.output

    // --- Kick: a deep membrane with a fast pitch drop, plus a click for attack.
    const kick = this.keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.045,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 },
        volume: 2,
      }).connect(out),
    )
    const kickClick = this.keep(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.012, sustain: 0 }, volume: -22 }).connect(
        this.keep(new Tone.Filter(3000, 'lowpass')).connect(out),
      ),
    )

    // --- Snare: a short tonal "body" plus bright noise for the wires.
    const snareBody = this.keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
        volume: -8,
      }).connect(out),
    )
    const snareFilter = this.keep(new Tone.Filter({ type: 'highpass', frequency: 1400, Q: 0.7 })).connect(out)
    const snareWires = this.keep(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -7 }).connect(
        snareFilter,
      ),
    )

    // --- Edge of the head: thinner and ringier — less body, higher noise band.
    const edgeFilter = this.keep(new Tone.Filter({ type: 'bandpass', frequency: 4200, Q: 1.4 })).connect(out)
    const edgeNoise = this.keep(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.22, sustain: 0 }, volume: -5 }).connect(
        edgeFilter,
      ),
    )
    const edgeRing = this.keep(
      new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 1, envelope: { attack: 0.001, decay: 0.25, sustain: 0 }, volume: -20 }).connect(
        out,
      ),
    )

    // --- Rim shot / cross-stick: a hard, woody crack.
    const rimTone = this.keep(
      new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 1.5, envelope: { attack: 0.001, decay: 0.06, sustain: 0 }, volume: -6 }).connect(
        out,
      ),
    )
    const rimFilter = this.keep(new Tone.Filter({ type: 'bandpass', frequency: 2600, Q: 2 })).connect(out)
    const rimNoise = this.keep(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.05, sustain: 0 }, volume: -2 }).connect(
        rimFilter,
      ),
    )

    // --- Stick click: two sticks hitting — very short, high and woody.
    const click = this.keep(
      new Tone.MembraneSynth({ pitchDecay: 0.004, octaves: 1.2, envelope: { attack: 0.0005, decay: 0.035, sustain: 0 }, volume: -6 }).connect(
        out,
      ),
    )

    // --- Hi-hats: MetalSynth with a high resonance; decay sets open vs closed.
    const hatFilter = this.keep(new Tone.Filter({ type: 'highpass', frequency: 7000 })).connect(out)
    const metal = (decay: number, volume: number, resonance = 4500, harmonicity = 5.1, modulationIndex = 32) =>
      this.keep(
        new Tone.MetalSynth({
          envelope: { attack: 0.001, decay, release: 0.02 },
          harmonicity,
          modulationIndex,
          resonance,
          octaves: 1.5,
          volume,
        }),
      )
    const hatClosed = metal(0.05, -16).connect(hatFilter)
    const hatOpen = metal(0.38, -18).connect(hatFilter)
    const hatPedal = metal(0.03, -22, 3500).connect(hatFilter)

    // --- Cymbals.
    const crash = metal(1.5, -16, 3200, 5.1, 40).connect(out)
    const crashNoiseFilter = this.keep(new Tone.Filter({ type: 'highpass', frequency: 5000 })).connect(out)
    const crashNoise = this.keep(
      new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 1.2, sustain: 0 }, volume: -22 }).connect(
        crashNoiseFilter,
      ),
    )
    const ride = metal(0.9, -22, 5200, 3.6, 18).connect(out)
    const rideBell = metal(0.7, -18, 6000, 2.2, 8).connect(out)

    // --- Toms: membranes tuned high → low.
    const tom = (decay: number) =>
      this.keep(
        new Tone.MembraneSynth({
          pitchDecay: 0.06,
          octaves: 2.5,
          envelope: { attack: 0.001, decay, sustain: 0, release: 0.1 },
          volume: -2,
        }).connect(out),
      )
    const tom1 = tom(0.35)
    const tom2 = tom(0.42)
    const floorTom = tom(0.55)

    return {
      kick: (t, v) => {
        kick.triggerAttackRelease('C1', 0.3, t, v)
        kickClick.triggerAttackRelease(0.01, t, v)
      },
      snare: (t, v) => {
        snareBody.triggerAttackRelease('G2', 0.1, t, v)
        snareWires.triggerAttackRelease(0.15, t, v)
      },
      snareEdge: (t, v) => {
        edgeNoise.triggerAttackRelease(0.2, t, v)
        edgeRing.triggerAttackRelease('E4', 0.2, t, v)
      },
      snareRim: (t, v) => {
        rimTone.triggerAttackRelease('E5', 0.05, t, v)
        rimNoise.triggerAttackRelease(0.04, t, v)
      },
      stickClick: (t, v) => click.triggerAttackRelease('A5', 0.03, t, v),
      hihatClosed: (t, v) => hatClosed.triggerAttackRelease(320, 0.05, t, v),
      hihatOpen: (t, v) => hatOpen.triggerAttackRelease(320, 0.3, t, v),
      hihatPedal: (t, v) => hatPedal.triggerAttackRelease(260, 0.03, t, v),
      crash: (t, v) => {
        crash.triggerAttackRelease(300, 1.2, t, v)
        crashNoise.triggerAttackRelease(1, t, v)
      },
      ride: (t, v) => ride.triggerAttackRelease(420, 0.6, t, v),
      rideBell: (t, v) => rideBell.triggerAttackRelease(620, 0.5, t, v),
      tom1: (t, v) => tom1.triggerAttackRelease('D3', 0.3, t, v),
      tom2: (t, v) => tom2.triggerAttackRelease('A2', 0.35, t, v),
      floorTom: (t, v) => floorTom.triggerAttackRelease('E2', 0.45, t, v),
    }
  }
}

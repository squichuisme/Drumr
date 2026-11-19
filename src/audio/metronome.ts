import * as Tone from 'tone'

/**
 * Metronome clicks: a short, high blip — higher on the downbeat.
 *
 * Two paths: regular clicks go through a gain you can switch off (the
 * metronome toggle), while count-in clicks always sound, even with the
 * metronome off, so you always know when to come in.
 */
export class Metronome {
  private readonly regularGain: Tone.Gain
  private readonly countInGain: Tone.Gain
  private readonly regular: Tone.Synth
  private readonly countIn: Tone.Synth
  private lastRegular = -1
  private lastCountIn = -1

  constructor(destination: Tone.InputNode) {
    this.regularGain = new Tone.Gain(0).connect(destination)
    this.countInGain = new Tone.Gain(1).connect(destination)
    const make = () =>
      new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
        volume: -8,
      })
    this.regular = make().connect(this.regularGain)
    this.countIn = make().connect(this.countInGain)
  }

  setEnabled(enabled: boolean): void {
    this.regularGain.gain.rampTo(enabled ? 1 : 0, 0.01)
  }

  /** Schedule a click at an exact audio-clock time. */
  click(time: number, accent: boolean, countIn: boolean): void {
    const synth = countIn ? this.countIn : this.regular
    const last = countIn ? this.lastCountIn : this.lastRegular
    const t = Math.max(time, last + 0.004)
    if (countIn) this.lastCountIn = t
    else this.lastRegular = t
    synth.triggerAttackRelease(accent ? 'A6' : 'E6', 0.03, t, accent ? 1 : 0.6)
  }

  dispose(): void {
    this.regular.dispose()
    this.countIn.dispose()
    this.regularGain.dispose()
    this.countInGain.dispose()
  }
}

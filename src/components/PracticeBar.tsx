import { useStore } from '../core/store'
import type { ScoreTimeline } from '../core/types'
import { MAX_BPM, MIN_BPM, type Playback } from '../hooks/usePlayback'
import { Icon, Toggle } from './TransportBar'

interface PracticeBarProps {
  id?: string
  /** Only matters on small screens, where the bar can be folded away. */
  open: boolean
  playback: Playback
  timeline: ScoreTimeline | null
  /** Printed measure numbers by written measure index. */
  numbers: string[]
  selecting: 'start' | 'end' | null
  onStartSelecting: () => void
  onCancelSelecting: () => void
}

/** Loop a range of measures, play along with muted drums, and the speed trainer. */
export function PracticeBar({ id, open, playback: p, timeline, numbers, selecting, onStartSelecting, onCancelSelecting }: PracticeBarProps) {
  const count = numbers.length
  const loop = p.loop
  const lo = loop ? Math.min(loop.startSource, loop.endSource) : 0
  const hi = loop ? Math.max(loop.startSource, loop.endSource) : 0

  /** Type a measure number into the from/to boxes (fallback to clicking). */
  function setLoopEnd(which: 'from' | 'to', value: string) {
    const index = numbers.indexOf(value.trim())
    const n = Number(value)
    const source = index >= 0 ? index : Number.isFinite(n) ? Math.min(count - 1, Math.max(0, Math.round(n) - 1)) : -1
    if (source < 0) return
    const start = which === 'from' ? source : loop ? lo : source
    const end = which === 'to' ? source : loop ? hi : source
    p.setLoop({ startSource: start, endSource: end })
  }

  return (
    <div id={id} className="practice" data-open={open} role="toolbar" aria-label="Practice tools">
      <div className="transport-group loop-group">
        <span className="group-label">
          <Icon name="loop" /> Loop
        </span>
        {selecting ? (
          <>
            <span className="hint">{selecting === 'start' ? 'Click the first measure…' : 'Now click the last measure…'}</span>
            <button type="button" className="btn btn--small" onClick={onCancelSelecting}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className={`btn btn--small${loop ? '' : ' btn--accent-outline'}`} onClick={onStartSelecting} disabled={!timeline}>
              {loop ? 'Pick again' : 'Pick measures'}
            </button>
            <span className="loop-range">
            <label className="measure-input">
              <span>from</span>
              <input
                type="number"
                min={1}
                max={count}
                inputMode="numeric"
                value={loop ? numbers[lo] : ''}
                placeholder="–"
                onChange={(e) => setLoopEnd('from', e.target.value)}
                aria-label="Loop from measure"
              />
            </label>
            <label className="measure-input">
              <span>to</span>
              <input
                type="number"
                min={1}
                max={count}
                inputMode="numeric"
                value={loop ? numbers[hi] : ''}
                placeholder="–"
                onChange={(e) => setLoopEnd('to', e.target.value)}
                aria-label="Loop to measure"
              />
            </label>
            </span>
            {loop && (
              <button type="button" className="link-btn" onClick={() => p.setLoop(null)}>
                clear
              </button>
            )}
          </>
        )}
      </div>

      <div className="transport-group">
        <Toggle on={p.playAlong} onChange={p.setPlayAlong} label="Play along (mute drums)" icon="mute" />
      </div>

      <div className="transport-group trainer-group">
        <Toggle on={p.trainer.enabled} onChange={(enabled) => p.setTrainer({ ...p.trainer, enabled })} label="Speed trainer" icon="trainer" />
        <span className={`trainer-settings${p.trainer.enabled ? '' : ' is-off'}`}>
          +
          <NumberField value={p.trainer.stepBpm} min={1} max={20} onChange={(stepBpm) => p.setTrainer({ ...p.trainer, stepBpm })} label="BPM to add" />
          BPM every
          <NumberField value={p.trainer.everyLoops} min={1} max={16} onChange={(everyLoops) => p.setTrainer({ ...p.trainer, everyLoops })} label="Loops between increases" />
          {p.trainer.everyLoops === 1 ? 'loop' : 'loops'}, up to
          <NumberField value={p.trainer.maxBpm} min={MIN_BPM} max={MAX_BPM} onChange={(maxBpm) => p.setTrainer({ ...p.trainer, maxBpm })} label="Maximum BPM" wide />
        </span>
        <LoopStatus playback={p} />
      </div>
    </div>
  )
}

/** "Pass 3 · next +5 in 1" — updates on every loop wrap. */
function LoopStatus({ playback: p }: { playback: Playback }) {
  const passes = useStore(p.stores.loopPasses)
  if (!p.loopRange) return null
  const t = p.trainer
  let detail = ''
  if (t.enabled) {
    if (p.tempo >= t.maxBpm) detail = ' · top tempo reached'
    else {
      const left = t.everyLoops - (passes % t.everyLoops)
      detail = ` · +${t.stepBpm} in ${left} ${left === 1 ? 'loop' : 'loops'}`
    }
  }
  return (
    <span className="loop-status">
      {p.loopingWholeScore ? 'Looping whole score · ' : ''}pass {passes + 1}
      {detail}
    </span>
  )
}

function NumberField({ value, min, max, onChange, label, wide }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; wide?: boolean }) {
  return (
    <input
      type="number"
      className={`num${wide ? ' num--wide' : ''}`}
      inputMode="numeric"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v))))
      }}
    />
  )
}

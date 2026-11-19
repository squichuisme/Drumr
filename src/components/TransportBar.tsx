import type { ReactNode } from 'react'
import { useStore } from '../core/store'
import { measureIndexAtBeat } from '../core/timeline'
import type { ScoreTimeline } from '../core/types'
import { MAX_BPM, MIN_BPM, type Playback } from '../hooks/usePlayback'
import type { ScoreLayout } from './ScoreView'

interface TransportBarProps {
  playback: Playback
  timeline: ScoreTimeline | null
  layout: ScoreLayout
  /** Extra controls (practice tools) shown at the end of the bar. */
  children?: ReactNode
}

/** Play/pause/stop, tempo, metronome and count-in, plus the position readout. */
export function TransportBar({ playback: p, timeline, layout, children }: TransportBarProps) {
  const playing = p.playState === 'playing'
  const scoreTempo = timeline ? Math.round(timeline.tempo) : null

  return (
    <div className="transport" role="toolbar" aria-label="Playback">
      <div className="transport-group">
        <button type="button" className="btn btn--icon" onClick={p.rewind} aria-label="Back to start" title="Back to start (Home)">
          <Icon name="rewind" />
        </button>
        <button
          type="button"
          className="btn btn--primary btn--play"
          onClick={p.playPause}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          disabled={!timeline || timeline.events.length === 0}
        >
          <Icon name={playing ? 'pause' : 'play'} />
          <span className="btn-text">{playing ? 'Pause' : p.playState === 'paused' ? 'Resume' : 'Play'}</span>
        </button>
        <button type="button" className="btn btn--icon" onClick={p.stop} aria-label="Stop" title="Stop">
          <Icon name="stop" />
        </button>
      </div>

      <div className="transport-group tempo">
        <label className="tempo-label" htmlFor="tempo">
          Tempo
        </label>
        <input
          id="tempo"
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={p.tempo}
          onChange={(e) => p.setTempo(Number(e.target.value))}
          aria-valuetext={`${p.tempo} BPM`}
        />
        <output className="tempo-value" htmlFor="tempo">
          {p.tempo}
          <small> BPM</small>
        </output>
        {scoreTempo !== null && p.tempo !== scoreTempo && (
          <button type="button" className="link-btn" onClick={() => p.setTempo(scoreTempo)} title="Reset to the score's tempo">
            reset to {scoreTempo}
          </button>
        )}
      </div>

      <div className="transport-group">
        <Toggle on={p.metronome} onChange={p.setMetronome} label="Metronome" icon="metronome" />
        <Toggle on={p.countIn} onChange={p.setCountIn} label="Count-in" icon="count" />
      </div>

      <div className="transport-group">
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => p.goToStep(p.stores.step.get() - 1)}
          aria-label="Previous note"
          title="Previous note (←)"
          disabled={playing}
        >
          <Icon name="prev" />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => p.goToStep(p.stores.step.get() + 1)}
          aria-label="Next note"
          title="Next note (→)"
          disabled={playing}
        >
          <Icon name="next" />
        </button>
        <PositionReadout playback={p} timeline={timeline} layout={layout} />
      </div>

      {children}
    </div>
  )
}

/** "Measure 3 · beat 2" — re-renders on every cursor move, so it's its own component. */
function PositionReadout({ playback, timeline, layout }: { playback: Playback; timeline: ScoreTimeline | null; layout: ScoreLayout }) {
  const stepIndex = useStore(playback.stores.step)
  const countIn = useStore(playback.stores.countIn)
  const step = layout.steps[stepIndex]
  let text = 'Press play, or step with ← →'
  if (countIn !== null) text = `Count-in ${countIn}…`
  else if (timeline && step) {
    const m = timeline.measures[measureIndexAtBeat(timeline, step.beat)]
    if (m) text = `Measure ${m.number} · beat ${formatBeat(step.beat - m.startBeat + 1)}`
  }
  return (
    <span className="transport-readout" aria-live="off">
      {text}
    </span>
  )
}

function formatBeat(beat: number): string {
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(2).replace(/0$/, '')
}

export function Toggle({ on, onChange, label, icon }: { on: boolean; onChange: (on: boolean) => void; label: string; icon?: IconName }) {
  return (
    <button type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      {icon && <Icon name={icon} />}
      {label}
    </button>
  )
}

type IconName = 'play' | 'pause' | 'stop' | 'rewind' | 'prev' | 'next' | 'metronome' | 'count' | 'loop' | 'mute' | 'trainer'

/** Small original line icons. */
export function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'icon' } as const
  switch (name) {
    case 'play':
      return (
        <svg {...common}>
          <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
          <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
        </svg>
      )
    case 'stop':
      return (
        <svg {...common}>
          <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" />
        </svg>
      )
    case 'rewind':
      return (
        <svg {...common}>
          <rect x="4.5" y="5" width="2.5" height="14" rx="1" fill="currentColor" />
          <path d="M19.5 5v14L8.5 12z" fill="currentColor" />
        </svg>
      )
    case 'prev':
      return (
        <svg {...common}>
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'next':
      return (
        <svg {...common}>
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'metronome':
      return (
        <svg {...common}>
          <path d="M9 3h6l4 18H5z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M12 16l5-9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )
    case 'count':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
          <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )
    case 'loop':
      return (
        <svg {...common}>
          <path d="M5 11V9a3 3 0 0 1 3-3h10l-3-3M19 13v2a3 3 0 0 1-3 3H6l3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'mute':
      return (
        <svg {...common}>
          <ellipse cx="11" cy="12" rx="7" ry="4" fill="none" stroke="currentColor" strokeWidth="1.9" />
          <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )
    case 'trainer':
      return (
        <svg {...common}>
          <path d="M4 17l5-5 4 4 7-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 8h5v5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

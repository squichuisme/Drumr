import type { DiagramMode, ScoreTimeline, Voice } from '../../core/types'
import { KitDiagram } from './KitDiagram'
import { MarchingDiagram } from './MarchingDiagram'

interface DiagramPanelProps {
  mode: DiagramMode
  onModeChange: (mode: DiagramMode) => void
  timeline: ScoreTimeline
  onAudition?: (voice: Voice) => void
}

/** The instrument diagram with a switch between drum kit and marching snare. */
export function DiagramPanel({ mode, onModeChange, timeline, onAudition }: DiagramPanelProps) {
  return (
    <section className="diagram-panel" aria-label="Instrument">
      <div className="diagram-header">
        <div className="segmented" role="radiogroup" aria-label="Instrument diagram">
          {(
            [
              ['kit', 'Drum kit'],
              ['marching', 'Marching snare'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={mode === value ? 'is-active' : ''}
              onClick={() => onModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="diagram-hint">Tap a drum to hear it</span>
      </div>
      {mode === 'kit' ? (
        <KitDiagram onAudition={onAudition} />
      ) : (
        <MarchingDiagram timeline={timeline} onAudition={onAudition} />
      )}
    </section>
  )
}

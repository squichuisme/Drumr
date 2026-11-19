import type { LoopSelection } from '../hooks/usePlayback'
import type { MeasureBox } from './ScoreView'

interface MeasureOverlayProps {
  boxes: MeasureBox[]
  /** Printed measure numbers by written measure index, for labels. */
  numbers: string[]
  loop: LoopSelection | null
  /** Picking a loop: which end we're waiting for, and the start picked so far. */
  selecting: 'start' | 'end' | null
  pendingStart: number | null
  /** Whether clicking does anything right now (not while playing, unless picking a loop). */
  interactive: boolean
  onMeasureClick: (sourceIndex: number) => void
}

/**
 * Transparent boxes over each measure of the score: they show the loop
 * range and turn clicks on the music into "loop from here" / "start here".
 */
export function MeasureOverlay({ boxes, numbers, loop, selecting, pendingStart, interactive, onMeasureClick }: MeasureOverlayProps) {
  const lo = loop ? Math.min(loop.startSource, loop.endSource) : -1
  const hi = loop ? Math.max(loop.startSource, loop.endSource) : -1

  return (
    <div className={`measure-layer${selecting ? ' is-selecting' : ''}`}>
      {boxes.map((b) => {
        const inLoop = b.sourceIndex >= lo && b.sourceIndex <= hi
        const classes = [
          'measure-box',
          inLoop && 'in-loop',
          inLoop && b.sourceIndex === lo && 'loop-start',
          inLoop && b.sourceIndex === hi && 'loop-end',
          pendingStart === b.sourceIndex && 'pending',
        ]
          .filter(Boolean)
          .join(' ')
        const number = numbers[b.sourceIndex] ?? String(b.sourceIndex + 1)
        const label =
          selecting === 'start'
            ? `Loop from measure ${number}`
            : selecting === 'end'
              ? `Loop to measure ${number}`
              : `Start from measure ${number}`
        return (
          <button
            key={b.sourceIndex}
            type="button"
            className={classes}
            style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
            aria-label={label}
            title={label}
            tabIndex={interactive ? 0 : -1}
            disabled={!interactive}
            onClick={() => onMeasureClick(b.sourceIndex)}
          >
            {inLoop && b.sourceIndex === lo && <span className="loop-tag">loop</span>}
          </button>
        )
      })}
    </div>
  )
}

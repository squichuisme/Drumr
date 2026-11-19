import { useMemo, useState } from 'react'
import { VOICE_LABELS } from '../config/drumMap'
import type { ScoreTimeline } from '../core/types'

/**
 * Debug view of the parsed timeline: every hit with its beat, drum, accent
 * and sticking. Handy for checking a drum map against your own MuseScore files.
 */
export function EventInspector({ timeline }: { timeline: ScoreTimeline }) {
  const [measure, setMeasure] = useState<number | 'all'>('all')
  const rows = useMemo(
    () => (measure === 'all' ? timeline.events : timeline.events.filter((e) => e.measureIndex === measure)),
    [timeline, measure],
  )
  // How many times each written measure has been played so far, to label repeats.
  const passLabels = useMemo(() => {
    const seen = new Map<number, number>()
    return timeline.measures.map((m) => {
      const pass = (seen.get(m.sourceIndex) ?? 0) + 1
      seen.set(m.sourceIndex, pass)
      return pass > 1 ? ` (time ${pass})` : ''
    })
  }, [timeline])
  const LIMIT = 500

  return (
    <details className="inspector">
      <summary>
        <span className="inspector-title">Parsed events</span>
        <span className="inspector-meta">
          {timeline.events.length} hits · {timeline.measures.length} measures played
          {timeline.measures.length !== timeline.sourceMeasureCount && ` (${timeline.sourceMeasureCount} written)`} ·{' '}
          {timeline.tempo} BPM{timeline.tempoFromScore ? '' : ' (default)'}
          {timeline.measures.some((m) => m.swing) && ' · swing 8ths (beats below are as written)'}
        </span>
      </summary>

      {timeline.warnings.length > 0 && (
        <ul className="inspector-warnings">
          {timeline.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <label className="field inspector-filter">
        <span className="field-label">Show</span>
        <select value={measure} onChange={(e) => setMeasure(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All measures</option>
          {timeline.measures.map((m) => (
            <option key={m.index} value={m.index}>
              Measure {m.number}
              {passLabels[m.index]}
            </option>
          ))}
        </select>
      </label>

      <div className="inspector-table-wrap">
        <table className="inspector-table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>Beat</th>
              <th>Drum</th>
              <th>Accent</th>
              <th>Sticking</th>
              <th>Velocity</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LIMIT).map((e, i) => {
              const m = timeline.measures[e.measureIndex]
              return (
                <tr key={i}>
                  <td>{m.number}</td>
                  <td>{(e.beat - m.startBeat + 1).toFixed(2)}</td>
                  <td>
                    {VOICE_LABELS[e.voice]}
                    {e.grace ? ' (grace)' : e.ghost ? ' (ghost)' : ''}
                  </td>
                  <td>{e.accent ? '>' : ''}</td>
                  <td>{e.sticking ?? ''}</td>
                  <td>{e.velocity.toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > LIMIT && <p className="inspector-more">…and {rows.length - LIMIT} more. Pick a measure to see them.</p>}
      </div>
    </details>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiagramPanel } from './components/diagrams/DiagramPanel'
import { EventInspector } from './components/EventInspector'
import { ScoreView, type ScoreLayout, type ScoreViewHandle } from './components/ScoreView'
import { hitBus } from './core/hitBus'
import { loadScoreFile } from './core/loadScoreFile'
import { parseScore } from './core/parseScore'
import { eventsInRange, measureIndexAtBeat } from './core/timeline'
import type { DiagramMode, NoteEvent, ScoreTimeline, Voice } from './core/types'
import { SAMPLES } from './samples'

interface LoadedScore {
  /** Where the score came from: a sample id or "file:<name>". */
  source: string
  label: string
  xml: string
}

const EMPTY_LAYOUT: ScoreLayout = { steps: [], measureBoxes: [] }

export default function App() {
  const [score, setScore] = useState<LoadedScore>(() => ({
    source: SAMPLES[0].id,
    label: SAMPLES[0].label,
    xml: SAMPLES[0].xml,
  }))
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scoreRef = useRef<ScoreViewHandle>(null)

  // Parse the MusicXML into timed drum events (see src/core/parseScore.ts).
  const parsed = useMemo((): { timeline: ScoreTimeline | null; error: string | null } => {
    try {
      return { timeline: parseScore(score.xml), error: null }
    } catch (err) {
      return { timeline: null, error: err instanceof Error ? err.message : String(err) }
    }
  }, [score.xml])
  const timeline = parsed.timeline

  // Cursor positions measured from the rendered score (recomputed on resize).
  const [layout, setLayout] = useState<ScoreLayout>(EMPTY_LAYOUT)
  const [stepIndex, setStepIndex] = useState(-1)

  // Diagram mode follows the score's suggestion until the user picks one.
  const [modeChoice, setModeChoice] = useState<{ xml: string; mode: DiagramMode } | null>(null)
  const mode: DiagramMode =
    modeChoice?.xml === score.xml ? modeChoice.mode : (timeline?.suggestedMode ?? 'kit')

  function selectScore(next: LoadedScore) {
    setLoadError(null)
    setScore(next)
    setStepIndex(-1)
    setLayout(EMPTY_LAYOUT)
    hitBus.reset()
  }

  function pickSample(id: string) {
    const sample = SAMPLES.find((s) => s.id === id)
    if (sample) selectScore({ source: sample.id, label: sample.label, xml: sample.xml })
  }

  async function pickFile(file: File | undefined) {
    if (!file) return
    try {
      const xml = await loadScoreFile(file)
      selectScore({ source: `file:${file.name}`, label: file.name, xml })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      // Allow picking the same file again later.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // --- Manual stepping: move the cursor one position and light what's under it.
  const goToStep = useCallback(
    (target: number) => {
      const steps = layout.steps
      if (!timeline || steps.length === 0) return
      const i = Math.min(Math.max(target, 0), steps.length - 1)
      setStepIndex(i)
      scoreRef.current?.showCursorAt(i)
      const from = i > 0 ? steps[i - 1].beat : -Infinity
      hitBus.emit(eventsInRange(timeline.events, from, steps[i].beat))
    },
    [layout, timeline],
  )

  // Keep the cursor where it was after a re-layout (e.g. window resize).
  const handleLayout = useCallback((next: ScoreLayout) => {
    setLayout(next)
    setStepIndex((i) => {
      if (i >= 0 && i < next.steps.length) queueMicrotask(() => scoreRef.current?.showCursorAt(i))
      return i < next.steps.length ? i : -1
    })
  }, [])

  // Keyboard: ← / → step through the score.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea, [contenteditable]')) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToStep(stepIndex + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToStep(stepIndex - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goToStep, stepIndex])

  // Tapping a drum on the diagram lights it (and, from feature 4, plays it).
  const audition = useCallback((voice: Voice) => {
    const hit: NoteEvent = {
      beat: 0,
      durationBeats: 0,
      voice,
      accent: false,
      ghost: false,
      grace: false,
      velocity: 0.85,
      sticking: null,
      measureIndex: 0,
      sourceMeasureIndex: 0,
    }
    hitBus.emit([hit])
  }, [])

  // Dev-only hook so automated browser checks can inspect timing data.
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __sticktrack: { timeline, layout } })
  }, [timeline, layout])

  const position = useMemo(() => {
    const step = layout.steps[stepIndex]
    if (!timeline || !step) return null
    const m = timeline.measures[measureIndexAtBeat(timeline, step.beat)]
    return m ? { measure: m.number, beat: step.beat - m.startBeat + 1 } : null
  }, [layout, stepIndex, timeline])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">StickTrack</span>
        </div>

        <div className="score-picker">
          <label className="field">
            <span className="field-label">Score</span>
            <select
              value={score.source.startsWith('file:') ? '' : score.source}
              onChange={(e) => pickSample(e.target.value)}
            >
              {score.source.startsWith('file:') && <option value="">{score.label}</option>}
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            Open MusicXML…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
      </header>

      <div className="transport" role="toolbar" aria-label="Playback">
        <div className="transport-group">
          <button type="button" className="btn btn--icon" onClick={() => goToStep(stepIndex - 1)} aria-label="Previous note">
            ◀
          </button>
          <button type="button" className="btn btn--icon" onClick={() => goToStep(stepIndex + 1)} aria-label="Next note">
            ▶
          </button>
          <span className="transport-readout">
            {position ? `Measure ${position.measure} · beat ${formatBeat(position.beat)}` : 'Step through with ◀ ▶ or the arrow keys'}
          </span>
        </div>
      </div>

      {(loadError || parsed.error) && (
        <div className="banner banner--error" role="alert">
          {loadError ?? `Couldn't read the drum notes: ${parsed.error}`}
        </div>
      )}

      <main className="workspace">
        <section className="score-panel" aria-label="Sheet music">
          <ScoreView ref={scoreRef} xml={score.xml} onLayout={handleLayout} />
          {timeline && <EventInspector timeline={timeline} />}
        </section>

        {timeline && (
          <DiagramPanel
            mode={mode}
            onModeChange={(m) => setModeChoice({ xml: score.xml, mode: m })}
            timeline={timeline}
            onAudition={audition}
          />
        )}
      </main>
    </div>
  )
}

function formatBeat(beat: number): string {
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(2).replace(/0$/, '')
}

/** Original mark: a drum head seen from above with two crossed sticks. */
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="18" r="11" className="logo-head" />
      <circle cx="16" cy="18" r="7" className="logo-ring" />
      <line x1="6" y1="3" x2="18" y2="16" className="logo-stick" />
      <line x1="26" y1="3" x2="14" y2="16" className="logo-stick" />
    </svg>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CountInOverlay } from './components/CountInOverlay'
import { DiagramPanel } from './components/diagrams/DiagramPanel'
import { EventInspector } from './components/EventInspector'
import { MeasureOverlay } from './components/MeasureOverlay'
import { PracticeBar } from './components/PracticeBar'
import { ScoreView, type ScoreLayout, type ScoreViewHandle } from './components/ScoreView'
import { TransportBar } from './components/TransportBar'
import { loadScoreFile } from './core/loadScoreFile'
import { parseScore } from './core/parseScore'
import type { DiagramMode, ScoreTimeline } from './core/types'
import { usePlayback } from './hooks/usePlayback'
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
  const playback = usePlayback({ timeline, layout, scoreRef })

  // Printed measure numbers, by written measure index (for labels and inputs).
  const measureNumbers = useMemo(() => {
    const numbers: string[] = []
    for (const m of timeline?.measures ?? []) numbers[m.sourceIndex] ??= m.number
    return numbers
  }, [timeline])

  // On phones/tablets the practice tools fold away behind a button.
  const [practiceOpen, setPracticeOpen] = useState(false)

  // Picking a loop by clicking two measures on the score.
  const [selecting, setSelecting] = useState<'start' | 'end' | null>(null)
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  const cancelSelecting = useCallback(() => {
    setSelecting(null)
    setPendingStart(null)
  }, [])
  function handleMeasureClick(sourceIndex: number) {
    if (selecting === 'start') {
      setPendingStart(sourceIndex)
      setSelecting('end')
    } else if (selecting === 'end') {
      playback.setLoop({ startSource: pendingStart ?? sourceIndex, endSource: sourceIndex })
      cancelSelecting()
    } else {
      playback.startFromMeasure(sourceIndex)
    }
  }

  // Diagram mode follows the score's suggestion until the user picks one.
  const [modeChoice, setModeChoice] = useState<{ xml: string; mode: DiagramMode } | null>(null)
  const mode: DiagramMode = modeChoice?.xml === score.xml ? modeChoice.mode : (timeline?.suggestedMode ?? 'kit')

  function selectScore(next: LoadedScore) {
    playback.stop()
    cancelSelecting()
    setLoadError(null)
    setLayout(EMPTY_LAYOUT)
    setScore(next)
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

  const handleLayout = useCallback((next: ScoreLayout) => setLayout(next), [])

  // Keyboard shortcuts: Space play/pause, ← → step, Home back to start.
  // Space means play/pause everywhere except text fields and dropdowns (a
  // focused toggle button won't swallow it; Enter still activates buttons).
  const { playPause, goToStep, rewind, stores } = playback
  useEffect(() => {
    const isTextEntry = (t: HTMLElement) =>
      !!t.closest('select, textarea, [contenteditable]') ||
      (t instanceof HTMLInputElement && !['range', 'checkbox', 'button'].includes(t.type))
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (isTextEntry(t) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        if (!e.repeat) playPause()
        return
      }
      if (t instanceof HTMLInputElement && t.type === 'range') return // arrows/Home adjust sliders
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToStep(stores.step.get() + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToStep(stores.step.get() - 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        rewind()
      } else if (e.key === 'Escape') {
        cancelSelecting()
      }
    }
    // Stop a focused button from also "clicking" on Space release.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTextEntry(e.target as HTMLElement)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [playPause, goToStep, rewind, stores, cancelSelecting])

  // Dev-only hook so automated browser checks can inspect timing data.
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __sticktrack: { timeline, layout, engine: playback.engine } })
  }, [timeline, layout, playback.engine])

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
            <select value={score.source.startsWith('file:') ? '' : score.source} onChange={(e) => pickSample(e.target.value)}>
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

      {/* Controls stick to the top of the screen on phones/tablets. */}
      <div className="controls" data-sticky="top">
        <TransportBar playback={playback} timeline={timeline} layout={layout}>
          <button
            type="button"
            className={`chip practice-toggle${practiceOpen || playback.loop || playback.playAlong || playback.trainer.enabled ? ' is-on' : ''}`}
            aria-expanded={practiceOpen}
            aria-controls="practice-tools"
            onClick={() => setPracticeOpen((o) => !o)}
          >
            Practice {practiceOpen ? '▴' : '▾'}
          </button>
        </TransportBar>
        <PracticeBar
          id="practice-tools"
          open={practiceOpen || selecting !== null}
          playback={playback}
          timeline={timeline}
          numbers={measureNumbers}
          selecting={selecting}
          onStartSelecting={() => {
            setPendingStart(null)
            setSelecting('start')
          }}
          onCancelSelecting={cancelSelecting}
        />
      </div>

      {(loadError || parsed.error) && (
        <div className="banner banner--error" role="alert">
          {loadError ?? `Couldn't read the drum notes: ${parsed.error}`}
        </div>
      )}

      <main className="workspace">
        <div className="score-wrap">
          <section className="score-panel" aria-label="Sheet music">
            <ScoreView ref={scoreRef} xml={score.xml} onLayout={handleLayout}>
              <MeasureOverlay
                boxes={layout.measureBoxes}
                numbers={measureNumbers}
                loop={playback.loop}
                selecting={selecting}
                pendingStart={pendingStart}
                interactive={selecting !== null || playback.playState !== 'playing'}
                onMeasureClick={handleMeasureClick}
              />
            </ScoreView>
            {timeline && <EventInspector timeline={timeline} />}
          </section>
          <CountInOverlay store={playback.stores.countIn} />
        </div>

        {timeline && (
          <DiagramPanel
            mode={mode}
            onModeChange={(m) => setModeChoice({ xml: score.xml, mode: m })}
            timeline={timeline}
            onAudition={playback.audition}
          />
        )}
      </main>
    </div>
  )
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

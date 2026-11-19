import { useRef, useState } from 'react'
import { ScoreView } from './components/ScoreView'
import { loadScoreFile } from './core/loadScoreFile'
import { SAMPLES } from './samples'

interface LoadedScore {
  /** Where the score came from: a sample id or "file:<name>". */
  source: string
  label: string
  xml: string
}

export default function App() {
  const [score, setScore] = useState<LoadedScore>(() => ({
    source: SAMPLES[0].id,
    label: SAMPLES[0].label,
    xml: SAMPLES[0].xml,
  }))
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function pickSample(id: string) {
    const sample = SAMPLES.find((s) => s.id === id)
    if (!sample) return
    setLoadError(null)
    setScore({ source: sample.id, label: sample.label, xml: sample.xml })
  }

  async function pickFile(file: File | undefined) {
    if (!file) return
    try {
      const xml = await loadScoreFile(file)
      setLoadError(null)
      setScore({ source: `file:${file.name}`, label: file.name, xml })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      // Allow picking the same file again later.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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

      {loadError && (
        <div className="banner banner--error" role="alert">
          {loadError}
        </div>
      )}

      <main className="workspace">
        <section className="score-panel" aria-label="Sheet music">
          <ScoreView xml={score.xml} />
        </section>
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

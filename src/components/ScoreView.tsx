import { useEffect, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

interface ScoreViewProps {
  /** MusicXML text to render. */
  xml: string
}

/**
 * Renders a MusicXML score with OpenSheetMusicDisplay (OSMD).
 *
 * OSMD lays the score out as an SVG inside our container div. We re-render
 * ourselves when the container width changes (instead of OSMD's built-in
 * autoResize) so later features can recompute cursor positions afterwards.
 */
export function ScoreView({ xml }: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  // Create the OSMD instance once.
  useEffect(() => {
    const container = containerRef.current!
    osmdRef.current = new OpenSheetMusicDisplay(container, {
      backend: 'svg',
      autoResize: false,
      drawTitle: true,
      drawSubtitle: false,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      autoBeam: false,
      followCursor: false,
      // -1 = never squash a drum staff onto one line just because it uses
      // few instruments (a 3-piece rock beat would otherwise collapse), but
      // still honour <staff-lines>1</staff-lines> for marching snare parts.
      percussionOneLineCutoff: -1,
    })
    return () => {
      osmdRef.current?.clear()
      osmdRef.current = null
    }
  }, [])

  // Load + render whenever the score text changes.
  useEffect(() => {
    const osmd = osmdRef.current
    if (!osmd) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    osmd
      .load(xml)
      .then(() => {
        if (cancelled) return
        osmd.render()
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [xml])

  // Re-render on width changes (debounced), since line breaks depend on width.
  useEffect(() => {
    const container = containerRef.current!
    let lastWidth = container.clientWidth
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth
      if (Math.abs(width - lastWidth) < 4) return
      lastWidth = width
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const osmd = osmdRef.current
        if (osmd?.IsReadyToRender()) osmd.render()
      }, 150)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="score-paper">
      {status === 'loading' && <p className="score-status">Rendering score…</p>}
      {status === 'error' && <p className="score-status score-status--error">Couldn't render this score: {error}</p>}
      <div ref={containerRef} className="score-osmd" />
    </div>
  )
}

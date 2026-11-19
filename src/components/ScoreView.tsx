import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/** One position the cursor can stop at (a column of notes or rests). */
export interface CursorStep {
  /** Time in quarter-note beats from the start, with repeats unrolled. */
  beat: number
  /** Box in pixels, relative to the score stage. */
  x: number
  y: number
  width: number
  height: number
  /** Written measure (0-based) this step is in. */
  sourceMeasureIndex: number
}

/** Clickable area of a written measure, in pixels relative to the score stage. */
export interface MeasureBox {
  sourceIndex: number
  x: number
  y: number
  width: number
  height: number
}

export interface ScoreLayout {
  steps: CursorStep[]
  measureBoxes: MeasureBox[]
}

export interface ScoreViewHandle {
  /** Move the cursor to a step (instantly — positions are precomputed). */
  showCursorAt(stepIndex: number): void
  hideCursor(): void
  /** The cursor element, so the page can keep it scrolled into view. */
  cursorElement(): HTMLElement | null
}

interface ScoreViewProps {
  /** MusicXML text to render. */
  xml: string
  /** Called after every (re)render with fresh cursor and measure positions. */
  onLayout?: (layout: ScoreLayout) => void
  ref?: Ref<ScoreViewHandle>
  /** Extra overlay content (loop highlight, measure click targets), drawn above the score. */
  children?: ReactNode
}

/**
 * Renders a MusicXML score with OpenSheetMusicDisplay (OSMD) and draws our
 * own playback cursor on top.
 *
 * Why our own cursor? OSMD's cursor can only step forward one note at a
 * time (next()), which is slow for jumps (stop, loops, seeking). So after
 * each render we walk OSMD's cursor through the whole score ONCE, recording
 * the musical time and on-screen box of every step. During playback we just
 * move a div to the right precomputed box.
 */
export function ScoreView({ xml, onLayout, ref, children }: ScoreViewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const layoutRef = useRef<ScoreLayout>({ steps: [], measureBoxes: [] })
  const onLayoutRef = useRef(onLayout)
  useLayoutEffect(() => {
    onLayoutRef.current = onLayout
  })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    showCursorAt(stepIndex: number) {
      const el = cursorRef.current
      const step = layoutRef.current.steps[stepIndex]
      if (!el || !step) return
      el.style.transform = `translate(${step.x}px, ${step.y}px)`
      el.style.width = `${step.width}px`
      el.style.height = `${step.height}px`
      el.hidden = false
    },
    hideCursor() {
      if (cursorRef.current) cursorRef.current.hidden = true
    },
    cursorElement: () => cursorRef.current,
  }))

  /** Render with OSMD, then measure where everything ended up. */
  function renderAndMeasure() {
    const osmd = osmdRef.current
    if (!osmd?.IsReadyToRender()) return
    osmd.render()
    layoutRef.current = computeLayout(osmd, stageRef.current!)
    if (cursorRef.current) cursorRef.current.hidden = true
    onLayoutRef.current?.(layoutRef.current)
  }

  // Create the OSMD instance once.
  useEffect(() => {
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current!, {
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
      cursorsOptions: [{ type: 0, color: '#c8572a', alpha: 0, follow: false }],
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
        renderAndMeasure()
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
    // renderAndMeasure only reads refs, so it isn't a dependency.
  }, [xml])

  // Line breaks depend on width, so re-render (debounced) when it changes.
  useEffect(() => {
    const container = containerRef.current!
    let lastWidth = container.clientWidth
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth
      if (Math.abs(width - lastWidth) < 4) return
      lastWidth = width
      window.clearTimeout(timer)
      timer = window.setTimeout(renderAndMeasure, 150)
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
      <div ref={stageRef} className="score-stage">
        <div ref={containerRef} className="score-osmd" />
        <div className="score-overlay">
          {children}
          <div ref={cursorRef} className="score-cursor" hidden />
        </div>
      </div>
    </div>
  )
}

/** Walk OSMD's cursor once and collect every step's beat and box, plus measure boxes. */
function computeLayout(osmd: OpenSheetMusicDisplay, stage: HTMLElement): ScoreLayout {
  const origin = stage.getBoundingClientRect()
  const steps: CursorStep[] = []
  const cursor = osmd.cursor
  if (!cursor) return { steps, measureBoxes: [] }

  // OSMD's cursor covers just the staff lines; pad it so notes above and
  // below the staff (hi-hats, cymbals, pedal) sit inside the highlight too.
  const pad = 14 * osmd.Zoom
  cursor.show()
  cursor.reset()
  let guard = 0
  while (!cursor.Iterator.EndReached && guard++ < 50000) {
    const box = cursor.cursorElement.getBoundingClientRect()
    steps.push({
      // OSMD measures time in whole notes; ×4 converts to quarter-note beats.
      // "Enrolled" = with repeats unrolled, matching our parser's timeline.
      beat: Math.round(cursor.Iterator.CurrentEnrolledTimestamp.RealValue * 4 * 1e6) / 1e6,
      x: box.left - origin.left,
      y: box.top - origin.top - pad,
      width: box.width,
      height: box.height + 2 * pad,
      sourceMeasureIndex: cursor.Iterator.CurrentMeasureIndex,
    })
    cursor.next()
  }
  cursor.reset()
  cursor.hide()

  // Measure boxes: horizontal extent from OSMD's layout, vertical extent from
  // the cursor (which spans the whole system).
  const svg = stage.querySelector('svg')
  const svgBox = svg?.getBoundingClientRect()
  const unit = 10 * osmd.Zoom // OSMD layout units → pixels
  const measureBoxes: MeasureBox[] = []
  osmd.GraphicSheet.MeasureList.forEach((staves, sourceIndex) => {
    const measures = staves.filter(Boolean)
    if (!measures.length || !svgBox) return
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const gm of measures) {
      const ps = gm.PositionAndShape
      left = Math.min(left, ps.AbsolutePosition.x + ps.BorderLeft)
      right = Math.max(right, ps.AbsolutePosition.x + ps.BorderRight)
      top = Math.min(top, ps.AbsolutePosition.y - 2)
      bottom = Math.max(bottom, ps.AbsolutePosition.y + 6)
    }
    const step = steps.find((s) => s.sourceMeasureIndex === sourceIndex)
    const x = svgBox.left - origin.left + left * unit
    measureBoxes.push({
      sourceIndex,
      x,
      width: (right - left) * unit,
      y: step ? step.y : svgBox.top - origin.top + top * unit,
      height: step ? step.height : (bottom - top) * unit,
    })
  })
  return { steps, measureBoxes }
}

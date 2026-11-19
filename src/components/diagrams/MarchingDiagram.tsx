import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MARCHING_ZONE_FOR_VOICE, type MarchingZone } from '../../config/drumMap'
import { hitBus } from '../../core/hitBus'
import type { Hand, NoteEvent, ScoreTimeline, Voice } from '../../core/types'
import { createRegistry, flash, flashHot } from './flash'

/**
 * Marching snare from above: one drum head split into playing zones
 * (center, edge, rim), a stick-click indicator, and R/L hand indicators
 * driven by the sticking written in the score.
 */

interface MarchingDiagramProps {
  timeline: ScoreTimeline
  onAudition?: (voice: Voice) => void
}

// Geometry (viewBox units). The drummer stands at the bottom of the picture.
const C = { x: 330, y: 212 }
const R = { center: 62, edgeInner: 98, head: 136, hoop: 152 }

/** Where a stick lands for each zone and hand (left hand hits left of center). */
const IMPACT: Record<Exclude<MarchingZone, 'click'>, Record<Hand | 'none', [number, number]>> = {
  center: { L: [C.x - 26, C.y + 14], R: [C.x + 26, C.y + 14], none: [C.x, C.y + 10] },
  edge: { L: [C.x - 70, C.y + 96], R: [C.x + 70, C.y + 96], none: [C.x, C.y + 118] },
  rim: { L: [C.x - 86, C.y + 118], R: [C.x + 86, C.y + 118], none: [C.x, C.y + 144] },
}

const ZONE_AUDITION: Record<MarchingZone, Voice> = {
  center: 'snare',
  edge: 'snareEdge',
  rim: 'snareRim',
  click: 'stickClick',
}

export function MarchingDiagram({ timeline, onAudition }: MarchingDiagramProps) {
  const reg = useMemo(createRegistry, [])

  // The sticking sequence (main strokes only), for the "what's next" ribbon.
  const sticking = useMemo(() => timeline.events.filter((e) => e.sticking && !e.grace), [timeline])
  const stickingIndex = useMemo(() => new Map(sticking.map((e, i) => [e, i])), [sticking])
  const [current, setCurrent] = useState(-1)

  useEffect(() => {
    const offHit = hitBus.subscribe((hits) => {
      for (const hit of hits) {
        const zone = MARCHING_ZONE_FOR_VOICE[hit.voice]
        if (!zone) continue // kick, cymbals etc. aren't on a marching snare
        flash(reg.get(`zone-${zone}`), hit)
        if (hit.accent) flashHot(reg.get(`zone-${zone}:hot`))
        if (zone !== 'click') showImpact(reg, zone, hit)
        if (hit.sticking) flash(reg.get(`hand-${hit.sticking}`), hit)
      }
      const withSticking = hits.find((h) => stickingIndex.has(h))
      if (withSticking) setCurrent(stickingIndex.get(withSticking)!)
    })
    const offReset = hitBus.onReset(() => setCurrent(-1))
    return () => {
      offHit()
      offReset()
    }
  }, [reg, stickingIndex])

  const zoneProps = (zone: MarchingZone, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': `${label} (tap to hear)`,
    className: 'piece',
    onPointerDown: () => onAudition?.(ZONE_AUDITION[zone]),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onAudition?.(ZONE_AUDITION[zone])
      }
    },
  })

  const lugs = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 10
    return <rect key={i} x={C.x + Math.cos(a) * (R.hoop + 5) - 4} y={C.y + Math.sin(a) * (R.hoop + 5) - 4} width="8" height="8" rx="2" className="lug" />
  })

  return (
    <div className="marching">
      <svg className="diagram diagram--marching" viewBox="0 0 660 380" role="img" aria-label="Marching snare, top view">
        <defs>
          <radialGradient id="ms-glow">
            <stop offset="0%" stopColor="var(--glow)" stopOpacity="0.95" />
            <stop offset="75%" stopColor="var(--glow)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--glow)" stopOpacity="0.2" />
          </radialGradient>
          <radialGradient id="ms-hot">
            <stop offset="0%" stopColor="var(--glow-hot)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--glow-hot)" stopOpacity="0" />
          </radialGradient>
          <filter id="ms-bloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* Hand indicators */}
        <HandBadge hand="L" x={72} reg={reg} />
        <HandBadge hand="R" x={588} reg={reg} />

        {/* Stick click: two crossed sticks above the drum */}
        <g {...zoneProps('click', 'Stick click')}>
          <rect x={C.x - 58} y="12" width="116" height="40" rx="12" className="click-pad" />
          <line x1={C.x - 36} y1="20" x2={C.x + 36} y2="44" className="stick" />
          <line x1={C.x + 36} y1="20" x2={C.x - 36} y2="44" className="stick" />
          <text x={C.x + 82} y="37" className="piece-label">
            CLICK
          </text>
        </g>
        <g ref={reg.ref('zone-click')} className="glow">
          <rect x={C.x - 58} y="12" width="116" height="40" rx="12" fill="url(#ms-glow)" />
          <rect x={C.x - 62} y="8" width="124" height="48" rx="14" className="glow-bloom" filter="url(#ms-bloom)" />
        </g>
        <g ref={reg.ref('zone-click:hot')} className="glow-hot">
          <rect x={C.x - 40} y="18" width="80" height="28" rx="12" fill="url(#ms-hot)" />
        </g>

        {/* Drum: lugs, hoop (rim), head with zone markings */}
        {lugs}
        <g {...zoneProps('rim', 'Rim')}>
          <circle cx={C.x} cy={C.y} r={(R.hoop + R.head) / 2} className="hoop-band" strokeWidth={R.hoop - R.head} />
        </g>
        <g {...zoneProps('edge', 'Edge')}>
          <circle cx={C.x} cy={C.y} r={R.head} className="head" />
        </g>
        <g {...zoneProps('center', 'Center')}>
          <circle cx={C.x} cy={C.y} r={R.center} className="head head--center" />
        </g>
        <circle cx={C.x} cy={C.y} r={R.edgeInner} className="zone-line" />
        <circle cx={C.x} cy={C.y} r={R.center} className="zone-line" />
        <text x={C.x} y={C.y + 5} className="zone-label">
          CENTER
        </text>
        <text x={C.x} y={C.y - (R.edgeInner + R.head) / 2 + 5} className="zone-label">
          EDGE
        </text>
        <text x={C.x + R.hoop + 22} y={C.y + 5} className="piece-label" textAnchor="start">
          RIM
        </text>

        {/* Zone highlights */}
        <g ref={reg.ref('zone-rim')} className="glow">
          <circle cx={C.x} cy={C.y} r={(R.hoop + R.head) / 2} className="glow-band" strokeWidth={R.hoop - R.head + 4} />
          <circle cx={C.x} cy={C.y} r={R.hoop + 4} className="glow-bloom" filter="url(#ms-bloom)" />
        </g>
        <g ref={reg.ref('zone-rim:hot')} className="glow-hot">
          <circle cx={C.x} cy={C.y} r={(R.hoop + R.head) / 2} className="glow-band glow-band--hot" strokeWidth={R.hoop - R.head} />
        </g>
        <g ref={reg.ref('zone-edge')} className="glow">
          <path d={annulus(R.edgeInner, R.head)} fill="url(#ms-glow)" fillRule="evenodd" />
        </g>
        <g ref={reg.ref('zone-edge:hot')} className="glow-hot">
          <path d={annulus(R.edgeInner + 8, R.head - 8)} fill="var(--glow-hot)" fillRule="evenodd" opacity="0.8" />
        </g>
        <g ref={reg.ref('zone-center')} className="glow">
          <circle cx={C.x} cy={C.y} r={R.center + 6} className="glow-bloom" filter="url(#ms-bloom)" />
          <circle cx={C.x} cy={C.y} r={R.center} fill="url(#ms-glow)" />
        </g>
        <g ref={reg.ref('zone-center:hot')} className="glow-hot">
          <circle cx={C.x} cy={C.y} r={R.center * 0.8} fill="url(#ms-hot)" />
        </g>

        {/* Stick impact dots, one per hand */}
        <circle ref={reg.ref('impact-L')} r="11" className="glow impact" cx={IMPACT.center.L[0]} cy={IMPACT.center.L[1]} />
        <circle ref={reg.ref('impact-R')} r="11" className="glow impact" cx={IMPACT.center.R[0]} cy={IMPACT.center.R[1]} />
      </svg>

      <StickingRibbon sequence={sticking} current={current} hasSticking={timeline.hasSticking} />
    </div>
  )
}

/** Move a hand's impact dot to where that stroke lands, then flash it. */
function showImpact(reg: ReturnType<typeof createRegistry>, zone: Exclude<MarchingZone, 'click'>, hit: NoteEvent) {
  const hand = hit.sticking ?? 'none'
  const dot = reg.get(`impact-${hit.sticking ?? 'R'}`)
  if (!dot) return
  const [x, y] = IMPACT[zone][hand]
  dot.setAttribute('cx', String(x))
  dot.setAttribute('cy', String(y))
  flash(dot, hit)
}

/** SVG path for a ring between two radii (drawn with the even-odd fill rule). */
function annulus(inner: number, outer: number): string {
  const circle = (r: number) => `M ${C.x - r} ${C.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
  return `${circle(outer)} ${circle(inner)}`
}

function HandBadge({ hand, x, reg }: { hand: Hand; x: number; reg: ReturnType<typeof createRegistry> }) {
  return (
    <g aria-label={hand === 'L' ? 'Left hand' : 'Right hand'}>
      <circle cx={x} cy={C.y} r="40" className="hand" />
      <circle ref={reg.ref(`hand-${hand}`)} cx={x} cy={C.y} r="40" className="glow hand-glow" />
      <text x={x} y={C.y + 14} className="hand-letter">
        {hand}
      </text>
      <text x={x} y={C.y + 62} className="piece-label">
        {hand === 'L' ? 'LEFT' : 'RIGHT'}
      </text>
    </g>
  )
}

/** A strip of upcoming sticking, with the current stroke highlighted. */
function StickingRibbon({ sequence, current, hasSticking }: { sequence: NoteEvent[]; current: number; hasSticking: boolean }) {
  if (!hasSticking) {
    return <p className="sticking-ribbon sticking-ribbon--empty">No sticking written in this score.</p>
  }
  const BEFORE = 3
  const AFTER = 9
  const start = Math.max(0, current - BEFORE)
  const window = sequence.slice(start, Math.max(current, 0) + AFTER + 1)
  return (
    <ol className="sticking-ribbon" aria-label="Sticking">
      {window.map((e, k) => {
        const i = start + k
        const state = i < current ? 'past' : i === current ? 'now' : 'next'
        return (
          <li key={i} className={`stroke stroke--${state} stroke--${e.sticking}${e.accent ? ' stroke--accent' : ''}`}>
            {e.sticking}
          </li>
        )
      })}
    </ol>
  )
}

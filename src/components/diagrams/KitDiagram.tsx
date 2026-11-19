import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { KIT_PIECE_FOR_VOICE, type KitPiece } from '../../config/drumMap'
import { hitBus } from '../../core/hitBus'
import type { Voice } from '../../core/types'
import { createRegistry, flash, flashHot } from './flash'

/**
 * Top-down drum kit, as seen from above with the drummer sitting at the
 * bottom of the picture (right-handed setup: hi-hat on the left, ride and
 * floor tom on the right).
 */

interface KitDiagramProps {
  /** Called when a piece is clicked/tapped, to audition its sound. */
  onAudition?: (voice: Voice) => void
}

/** Which highlight layers a voice lights up. Most voices light their whole piece. */
function targetsFor(voice: Voice): string[] {
  switch (voice) {
    case 'snareRim':
    case 'stickClick':
      return ['snare-rim']
    case 'hihatPedal':
      return ['hihat-pedal']
    case 'hihatOpen':
      return ['hihat', 'hihat-open']
    case 'rideBell':
      return ['ride-bell']
    default:
      return [KIT_PIECE_FOR_VOICE[voice]]
  }
}

/** The voice auditioned when a piece is clicked. */
const AUDITION: Record<KitPiece | 'hihat-pedal', Voice> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hihatClosed',
  'hihat-pedal': 'hihatPedal',
  tom1: 'tom1',
  tom2: 'tom2',
  floorTom: 'floorTom',
  crash: 'crash',
  ride: 'ride',
}

// Geometry (viewBox units).
const P = {
  crash: { cx: 150, cy: 92, r: 66 },
  ride: { cx: 540, cy: 150, r: 78 },
  hihat: { cx: 92, cy: 225, r: 50 },
  snare: { cx: 205, cy: 268, r: 50 },
  tom1: { cx: 280, cy: 150, r: 40 },
  tom2: { cx: 382, cy: 150, r: 43 },
  floorTom: { cx: 470, cy: 288, r: 58 },
  kick: { x: 280, y: 168, w: 104, h: 134 },
  pedal: { x: 79, y: 300, w: 26, h: 56 },
}

export function KitDiagram({ onAudition }: KitDiagramProps) {
  const [reg] = useState(createRegistry)

  useEffect(
    () =>
      hitBus.subscribe((hits) => {
        for (const hit of hits) {
          for (const target of targetsFor(hit.voice)) {
            flash(reg.get(target), hit)
            if (hit.accent) flashHot(reg.get(`${target}:hot`))
          }
        }
      }),
    [reg],
  )

  const press = (piece: keyof typeof AUDITION) => () => onAudition?.(AUDITION[piece])
  const keyPress = (piece: keyof typeof AUDITION) => (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onAudition?.(AUDITION[piece])
    }
  }
  const interactive = (piece: keyof typeof AUDITION, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': `${label} (tap to hear)`,
    className: 'piece',
    onPointerDown: press(piece),
    onKeyDown: keyPress(piece),
  })

  return (
    <svg className="diagram diagram--kit" viewBox="0 0 660 380" role="img" aria-label="Drum kit, top view">
      <defs>
        <radialGradient id="kit-metal" cx="45%" cy="40%" r="70%">
          <stop offset="0%" stopColor="var(--metal)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--metal)" />
        </radialGradient>
        <radialGradient id="kit-glow">
          <stop offset="0%" stopColor="var(--glow)" stopOpacity="0.95" />
          <stop offset="70%" stopColor="var(--glow)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--glow)" stopOpacity="0.25" />
        </radialGradient>
        <radialGradient id="kit-hot">
          <stop offset="0%" stopColor="var(--glow-hot)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--glow-hot)" stopOpacity="0" />
        </radialGradient>
        <filter id="kit-bloom" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* Kick drum: a cylinder lying on its side, seen from above */}
      <g {...interactive('kick', 'Kick drum')}>
        <rect x={P.kick.x} y={P.kick.y} width={P.kick.w} height={P.kick.h} rx="12" className="shell" />
        <rect x={P.kick.x + 4} y={P.kick.y} width={P.kick.w - 8} height="12" rx="5" className="hoop" />
        <rect x={P.kick.x + 4} y={P.kick.y + P.kick.h - 12} width={P.kick.w - 8} height="12" rx="5" className="hoop" />
        <rect x="318" y="306" width="24" height="40" rx="5" className="pedal-board" />
        <circle cx="330" cy="304" r="7" className="beater" />
        <text x="332" y="244" className="piece-label piece-label--on-shell">
          KICK
        </text>
      </g>
      <Glow kind="rect" reg={reg} name="kick" x={P.kick.x} y={P.kick.y} w={P.kick.w} h={P.kick.h} />

      {/* Hi-hat stand pedal (separate target for the foot) */}
      <g {...interactive('hihat-pedal', 'Hi-hat pedal')}>
        <rect x={P.pedal.x} y={P.pedal.y} width={P.pedal.w} height={P.pedal.h} rx="6" className="pedal-board" />
        <text x={P.pedal.x + P.pedal.w / 2} y={P.pedal.y + P.pedal.h + 16} className="piece-label">
          HH PEDAL
        </text>
      </g>
      <Glow kind="rect" reg={reg} name="hihat-pedal" x={P.pedal.x} y={P.pedal.y} w={P.pedal.w} h={P.pedal.h} />

      <Drum {...P.snare} lugs={10} label="SNARE" reg={reg} name="snare" interactive={interactive('snare', 'Snare drum')} strainer />
      <Drum {...P.tom1} lugs={6} label="TOM 1" reg={reg} name="tom1" interactive={interactive('tom1', 'High tom')} />
      <Drum {...P.tom2} lugs={6} label="TOM 2" reg={reg} name="tom2" interactive={interactive('tom2', 'Low tom')} />
      <Drum {...P.floorTom} lugs={8} label="FLOOR" reg={reg} name="floorTom" interactive={interactive('floorTom', 'Floor tom')} />

      <Cymbal {...P.hihat} label="HI-HAT" reg={reg} name="hihat" interactive={interactive('hihat', 'Hi-hat')} openRing />
      <Cymbal {...P.crash} label="CRASH" reg={reg} name="crash" interactive={interactive('crash', 'Crash cymbal')} />
      <Cymbal {...P.ride} label="RIDE" reg={reg} name="ride" interactive={interactive('ride', 'Ride cymbal')} bell />
    </svg>
  )
}

type Registry = ReturnType<typeof createRegistry>
type Interactive = Record<string, unknown>

/** Highlight layers for one piece: an orange glow plus a white-hot core for accents. */
function Glow(
  props:
    | { kind: 'circle'; reg: Registry; name: string; cx: number; cy: number; r: number }
    | { kind: 'rect'; reg: Registry; name: string; x: number; y: number; w: number; h: number },
) {
  const { reg, name } = props
  if (props.kind === 'rect') {
    const { x, y, w, h } = props
    return (
      <>
        <g ref={reg.ref(name)} className="glow">
          <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx="16" className="glow-bloom" filter="url(#kit-bloom)" />
          <rect x={x} y={y} width={w} height={h} rx="12" fill="url(#kit-glow)" />
        </g>
        <g ref={reg.ref(`${name}:hot`)} className="glow-hot">
          <rect x={x + w * 0.15} y={y + h * 0.15} width={w * 0.7} height={h * 0.7} rx="20" fill="url(#kit-hot)" />
        </g>
      </>
    )
  }
  const { cx, cy, r } = props
  return (
    <>
      <g ref={reg.ref(name)} className="glow">
        <circle cx={cx} cy={cy} r={r + 5} className="glow-bloom" filter="url(#kit-bloom)" />
        <circle cx={cx} cy={cy} r={r} fill="url(#kit-glow)" />
      </g>
      <g ref={reg.ref(`${name}:hot`)} className="glow-hot">
        <circle cx={cx} cy={cy} r={r * 0.75} fill="url(#kit-hot)" />
      </g>
    </>
  )
}

function Drum(props: {
  cx: number
  cy: number
  r: number
  lugs: number
  label: string
  reg: Registry
  name: string
  interactive: Interactive
  strainer?: boolean
}) {
  const { cx, cy, r, lugs, label, reg, name, interactive, strainer } = props
  const lugMarks = Array.from({ length: lugs }, (_, i) => {
    const a = (i / lugs) * Math.PI * 2 + Math.PI / lugs
    return <circle key={i} cx={cx + Math.cos(a) * (r + 3)} cy={cy + Math.sin(a) * (r + 3)} r="3.2" className="lug" />
  })
  return (
    <>
      <g {...interactive}>
        {lugMarks}
        {strainer && <rect x={cx - r - 9} y={cy - 7} width="8" height="14" rx="2" className="lug" />}
        <circle cx={cx} cy={cy} r={r} className="hoop-ring" />
        <circle cx={cx} cy={cy} r={r - 4} className="head" />
        <circle cx={cx} cy={cy} r={(r - 4) * 0.55} className="head-ring" />
        <text x={cx} y={cy + 4} className="piece-label piece-label--dark">
          {label}
        </text>
      </g>
      <Glow kind="circle" reg={reg} name={name} cx={cx} cy={cy} r={r} />
      {name === 'snare' && (
        // Rim zone of the snare, lit by rim shots / cross-sticks.
        <circle ref={reg.ref('snare-rim')} cx={cx} cy={cy} r={r - 1} className="glow glow-ring" />
      )}
    </>
  )
}

function Cymbal(props: {
  cx: number
  cy: number
  r: number
  label: string
  reg: Registry
  name: string
  interactive: Interactive
  bell?: boolean
  openRing?: boolean
}) {
  const { cx, cy, r, label, reg, name, interactive, bell, openRing } = props
  return (
    <>
      <g {...interactive}>
        <circle cx={cx} cy={cy} r={r} fill="url(#kit-metal)" className="cymbal" />
        {[0.82, 0.64, 0.46].map((k) => (
          <circle key={k} cx={cx} cy={cy} r={r * k} className="lathe" />
        ))}
        <circle cx={cx} cy={cy} r={r * 0.24} className="bell" />
        <circle cx={cx} cy={cy} r="3" className="cymbal-hole" />
        <text x={cx} y={cy + r * 0.62} className="piece-label piece-label--dark">
          {label}
        </text>
      </g>
      <Glow kind="circle" reg={reg} name={name} cx={cx} cy={cy} r={r} />
      {bell && (
        <g ref={reg.ref(`${name}-bell`)} className="glow">
          <circle cx={cx} cy={cy} r={r * 0.3} fill="url(#kit-glow)" />
          <circle cx={cx} cy={cy} r={r * 0.3} className="glow-bloom" filter="url(#kit-bloom)" />
        </g>
      )}
      {openRing && (
        // Dashed ring that pulses outward for an open hi-hat.
        <circle ref={reg.ref(`${name}-open`)} cx={cx} cy={cy} r={r + 9} className="glow glow-open" />
      )}
    </>
  )
}

# StickTrack

A drum practice app that runs entirely in the browser. Load drum sheet music (MusicXML) and StickTrack shows it with a moving cursor, lights up the matching drum on a diagram of the instrument as each note is played, and plays it back with synthesized drum sounds.

- **Scores:** open `.musicxml`, `.xml` or compressed `.mxl` files (e.g. exported from MuseScore), or try the built-in samples.
- **Instrument diagram:** a top-down drum kit (kick, snare, hi-hat, 2 rack toms, floor tom, crash, ride) or a marching snare with center / edge / rim zones, stick clicks and R/L sticking. Simultaneous hits light up together; accents flash brighter.
- **Playback:** play / pause / stop, tempo 40–200 BPM (defaults to the score's tempo), metronome, one-bar count-in. Sounds are synthesized with Tone.js — no sample files.
- **Practice tools:** loop a range of measures, play-along mode (drums muted, metronome on, lights still showing what to play), and a speed trainer that adds X BPM every N loops.
- **Layout:** score on top and diagram below on desktop; on phones and tablets the controls stick to the top and the diagram to the bottom. The score scrolls itself to follow the cursor.

No backend, no accounts.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. Press **Play** (audio starts on your first click, as browsers require).

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Type-check and build to `dist/` (a static site you can host anywhere) |
| `npm run lint` | Lint with oxlint |
| `npm run samples` | Regenerate the sample scores from `scripts/generate-samples.mjs` |
| `npm run drift-check` | Real-time sync test in headless Chromium (needs `npm run dev` running) |

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Step the cursor one note back / forward (lights up what's under it) |
| Home | Back to the start (or the loop start) |
| Esc | Cancel picking a loop |

## How it works

```
MusicXML ──► parseScore() ──► ScoreTimeline (hits in beats) ──┬──► planSession() ──► Tone.Transport ──► sounds
   │                                                         │                         │
   └──► OSMD renders the score ──► cursor step positions ────┘                         └──► Tone.Draw ──► cursor + lights
```

1. **Parsing** (`src/core/parseScore.ts`): reads the MusicXML and produces one event per drum hit: its time in beats (quarter notes), which drum, accent, ghost/grace, and sticking. It handles chords, multiple voices, ties, tuplets, grace notes (flams), single-note tremolos (rolls/diddles), repeats and 1st/2nd endings.
2. **Drum mapping** (`src/config/drumMap.ts`): decides which drum each note is. See below.
3. **Rendering** (`src/components/ScoreView.tsx`): [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) draws the score. After each render StickTrack walks OSMD's cursor through the score once and records the beat and on-screen box of every cursor position, so jumping the cursor is instant.
4. **Playback** (`src/audio/`): `planSession()` turns the timeline into a list of Transport ticks for count-in clicks, metronome clicks, drum hits and cursor moves. `PlaybackEngine` puts all of them on **one** `Tone.Transport`. Sounds start at the exact audio-clock time Tone hands over; the cursor and lights are drawn through `Tone.Draw` at that same time. Nothing uses `setTimeout`, so nothing can drift.

### Sync check

`npm run drift-check` plays the 32-bar sample at 160 BPM in headless Chromium, records every cursor move, and taps the real audio output with an AudioWorklet to detect each rendered drum hit. Typical result:

```
audio drift:        max 0.000 ms over all 32 bars
cursor vs audio:    mean 0.3 ms, p95 9.1 ms, max 12.3 ms (0 of 256 moves more than one 60 Hz frame off)
rendered audio:     onsets match the cursor with median 0.2 ms, p95 1.3 ms
drift bar 1 → 32:   cursor offset changed by 0.9 ms
PASS: cursor, lights and audio stay locked through bar 32
```

(The check also caught one real problem: a limiter on the master bus delayed every sound by ~6 ms because of Web Audio's compressor look-ahead. It was replaced with a zero-latency soft clipper.)

## Editing the drum map

Everything about which note plays which drum lives in **`src/config/drumMap.ts`**. For each note StickTrack tries, in order (`resolutionOrder`):

1. **Instrument name.** MuseScore tags every drum note with `<instrument id="…"/>`, pointing to a `<score-instrument>` such as "Acoustic Snare". The name is matched against `instrumentNameRules`; the first match wins.
2. **MIDI number.** The same instrument's General MIDI drum note (36 = kick, 38 = snare, 42 = closed hi-hat…), looked up in `midiNotes`.
3. **Staff position + notehead.** The standard drum key in `fiveLineStaff`, counted in steps from the bottom line:

| Position | Where | Drum |
| --- | --- | --- |
| 10 | x on the ledger line above | crash |
| 9 | x above the staff | hi-hat (circled x = open) |
| 8 | x on the top line | ride (diamond = bell) |
| 7 | 4th space | high rack tom |
| 6 | 4th line | low rack tom |
| 5 | 3rd space | snare (x = cross-stick) |
| 3 | 2nd space | floor tom |
| 1 | bottom space | kick |
| −1 | x below the staff | hi-hat pedal |

One-line staves (marching snare) use `singleLineStaff`: on the line = center (diamond = edge, x = rim shot), above the line = stick click. "Edge" text written above the staff switches snare notes to the edge zone until "center" / "norm." / "ord.".

Notes that match nothing are listed as warnings in the **Parsed events** panel under the score, which also shows every hit the parser found — handy for checking your own files.

### Tips for MuseScore files

- Export with **File → Export → MusicXML** (`.musicxml` or compressed `.mxl`).
- **Sticking:** add R/L as lyrics, as fingering, or as staff text right before the note. A lowercase grace letter like `lR` (a flam) counts as R.
- **Accents:** `>` (accent) and `^` (marcato) both give the brighter accent flash and louder sound. Parenthesised noteheads play as ghost notes.

## Project layout

```
src/
  config/drumMap.ts        ← the editable drum map
  core/                    pure logic, unit tested
    parseScore.ts          MusicXML → timed hits
    drumMapping.ts         applies the drum map to one note
    repeats.ts             repeat / volta unrolling
    loadScoreFile.ts       .musicxml / .xml / .mxl → XML text
    timeline.ts, hitBus.ts, store.ts, autoScroll.ts
  audio/
    schedule.ts            planSession(): what to schedule at which tick (unit tested)
    PlaybackEngine.ts      Tone.Transport + Tone.Draw
    drumKit.ts, metronome.ts   synthesized sounds
  components/              React UI (score view, transport, practice bar, diagrams)
  hooks/usePlayback.ts     connects the engine to the UI
  samples/                 generated sample scores
scripts/
  generate-samples.mjs     writes the sample MusicXML files
  drift-check.cjs          real-time sync test
```

## Known limitations

- D.S., D.C., Coda and Fine jumps aren't followed yet (repeat barlines and 1st/2nd endings are).
- Tempo changes partway through a score are ignored; the first tempo marking is used.
- Grace notes placed right before a loop's first beat are replayed just before each loop wrap; other notes outside the loop are skipped.

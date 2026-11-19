# StickTrack

A drum practice app that runs entirely in the browser. Load drum sheet music (MusicXML) and StickTrack shows it with a moving cursor, lights up the matching drum on a diagram of the instrument as each note is played, and plays it back with synthesized drum sounds.

- **Scores:** open `.musicxml`, `.xml` or compressed `.mxl` files (e.g. exported from MuseScore), or try the built-in samples — including a set of jazz drumset lessons.
- **Swing:** jazz written in straight 8ths with a "Swing" marking is played with real swing (the off-beat 8th on the last note of a triplet), and you can switch the feel between straight, light, triplet and hard swing.
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

## Samples

| Sample | What you practise |
| --- | --- |
| **Jazz 1. Ride pattern & hi-hat** | The jazz time feel: ride "spang, spang-a-lang" (1, 2 &, 3, 4 &), hi-hat with the foot on 2 & 4, then a feathered (very soft) bass drum on every beat |
| **Jazz 2. Comping on snare & bass drum** | Short snare/bass figures under steady time: "and" of 4, "and" of 2, the Charleston rhythm, a bass drum bomb, ghost notes |
| **Jazz 3. Jazz waltz** | Swing in 3/4: ride 1, 2 &, 3 with the hi-hat on 2, then on 2 & 3 |
| **Jazz 4. Time & triplet fills** | Three bars of time and a one-bar fill: 8th-note triplets around the kit, then "hand-hand-foot" triplets (R L + bass drum), with sticking |
| Basic rock beat | 8th-note hi-hat, snare on 2 & 4, kick on 1 & 3 (with a repeat) |
| 8th-note groove with fills | Open hi-hat, hi-hat pedal, 16th-note fills, 1st/2nd endings |
| Marching snare | 8 on a hand, accent/tap, and every playing zone (center, edge, rim, stick click) |
| Drift check | 32 bars at 160 BPM, used by `npm run drift-check` |

A good way to use the jazz samples: start at a slow tempo with **Play along** on (drums muted, metronome on, the lights show what to play), loop two bars, and let the **Speed trainer** push the tempo up as you get comfortable. Switch **Swing** to *Straight* once to hear exactly what the swing feel changes.

## Swing

Jazz drum parts are written in plain 8th notes with a "Swing" marking, but the 8ths are played long-short: the "and" of each beat comes late, on the last note of a triplet. StickTrack does the same:

- It reads MusicXML's swing playback setting (`<sound><swing>`, which MuseScore 4 writes) or style text such as "Swing", "Medium swing", "Shuffle" or "Jazz waltz". "Straight", "Latin" or "Bossa" switch back to straight 8ths. These text patterns are in `src/config/drumMap.ts` (`textModes.swingOn` / `swingOff`).
- During playback only notes exactly on the "and" move later. Downbeats, triplets and 16ths stay where they're written, as a jazz drummer would play them. The cursor moves with the swung note, so it stays locked to the sound.
- The **Swing** control overrides the score: *As written*, *Straight*, *Light (3:2)*, *Triplet (2:1)* or *Hard (3:1)*. It can also swing a straight groove, e.g. to practise a shuffle on the rock beat.
- The Parsed events panel lists beats **as written**; the swing is applied when the notes are played.

## How it works

```
MusicXML ──► parseScore() ──► ScoreTimeline (hits in beats) ──┬──► planSession() ──► Tone.Transport ──► sounds
   │                                                         │                         │
   └──► OSMD renders the score ──► cursor step positions ────┘                         └──► Tone.Draw ──► cursor + lights
```

1. **Parsing** (`src/core/parseScore.ts`): reads the MusicXML and produces one event per drum hit: its time in beats (quarter notes), which drum, accent, ghost/grace, and sticking. It handles chords, multiple voices, ties, tuplets, grace notes (flams), single-note tremolos (rolls/diddles), repeats and 1st/2nd endings.
2. **Drum mapping** (`src/config/drumMap.ts`): decides which drum each note is. See below.
3. **Rendering** (`src/components/ScoreView.tsx`): [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) draws the score. After each render StickTrack walks OSMD's cursor through the score once and records the beat and on-screen box of every cursor position, so jumping the cursor is instant.
4. **Playback** (`src/audio/`): `planSession()` turns the timeline into a list of Transport ticks for count-in clicks, metronome clicks, drum hits and cursor moves, applying swing to hits and cursor alike. `PlaybackEngine` puts all of them on **one** `Tone.Transport`. Sounds start at the exact audio-clock time Tone hands over; the cursor and lights are drawn through `Tone.Draw` at that same time. Nothing uses `setTimeout`, so nothing can drift.

### Sync check

`npm run drift-check` plays the 32-bar sample at 160 BPM in headless Chromium, records every cursor move, and taps the real audio output with an AudioWorklet to detect each rendered drum hit. Typical result:

```
audio drift:        max 0.000 ms over all 32 bars
cursor vs audio:    mean 2.0 ms, p95 9.9 ms, max 11.6 ms (0 of 256 moves more than one 60 Hz frame off)
rendered audio:     onsets match the cursor with median 0.2 ms, p95 1.3 ms (252 matched)
drift bar 1 → 32:   cursor offset trend 1.46 ms over 32 bars (line fitted through all 256 moves)
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
- **Accents:** `>` (accent) and `^` (marcato) both give the brighter accent flash and louder sound. Parenthesised noteheads play as ghost notes (use them for a feathered bass drum or ghosted snare).
- **Swing:** add "Swing" text above the first bar (MuseScore's Tempo palette has one, or type it as staff text). StickTrack reads either the exported swing setting or the text itself.

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
- A swing marking takes effect from the start of the bar it's written in.
- Grace notes placed right before a loop's first beat are replayed just before each loop wrap; other notes outside the loop are skipped.

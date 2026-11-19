/**
 * Timing-drift check: plays the "Drift check: 32 bars at 160 BPM" sample in a
 * real (headless) Chromium in real time and measures, for every cursor move:
 *   1. audio drift   — scheduled audio time vs. where the tempo says it should be
 *   2. visual offset — when the cursor actually moved vs. when its notes sound
 *   3. rendered audio — onsets detected in the real audio output (AudioWorklet
 *      tap on the master bus) vs. the cursor's scheduled time
 * Pass = no growth over 32 bars and every offset within about one video frame.
 *
 * Usage: start the dev server (npm run dev), then: node scripts/drift-check.cjs
 */
const { chromium } = require('playwright')

const URL = process.env.STICKTRACK_URL || 'http://localhost:5173/'
const BPM = 160

;(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL)
  await page.waitForFunction(() => window.__sticktrack?.layout?.steps?.length > 0)
  const driftIndex = await page.$$eval('.score-picker select option', (opts) => opts.findIndex((o) => /drift/i.test(o.textContent)))
  await page.selectOption('.score-picker select', { index: driftIndex })
  await page.waitForFunction(() => window.__sticktrack?.timeline?.title?.startsWith('Drift') && window.__sticktrack.layout.steps.length > 200)

  // Record cursor timing and tap the real audio output.
  await page.evaluate(async () => {
    const st = window.__sticktrack
    window.__timings = []
    window.__tap = []
    st.engine.onStepTiming = (t) => window.__timings.push(t)
    const { context, destination } = st.engine.debugAudio()
    // Peak level of every 16-sample slice of the master output (~0.36 ms resolution).
    const code = `class Tap extends AudioWorkletProcessor {
      constructor() { super(); this.buf = [] }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0]
        for (let start = 0; start < 128; start += 16) {
          let peak = 0
          if (ch) for (let i = start; i < start + 16; i++) peak = Math.max(peak, Math.abs(ch[i]))
          this.buf.push(currentFrame + start, peak)
        }
        if (this.buf.length >= 4096) { this.port.postMessage(this.buf); this.buf = [] }
        return true
      }
    }
    registerProcessor('sticktrack-tap', Tap)`
    await context.addAudioWorkletModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
    const node = context.createAudioWorkletNode('sticktrack-tap')
    node.port.onmessage = (e) => { for (const v of e.data) window.__tap.push(v) }
    destination.connect(node)
    node.connect(context.rawContext.destination)
    window.__sampleRate = context.sampleRate
  })

  await page.click('.btn--play')
  // 1 bar count-in + 32 bars at 160 BPM = 49.5 s, then playback stops itself.
  await page.waitForFunction(() => document.querySelector('.btn--play')?.textContent.includes('Play') && window.__timings.length > 200, null, {
    timeout: 90000,
    polling: 500,
  })
  await page.waitForTimeout(500)
  const { timings, tap, sampleRate, steps, measures } = await page.evaluate(() => ({
    timings: window.__timings,
    tap: window.__tap,
    sampleRate: window.__sampleRate,
    steps: window.__sticktrack.layout.steps.map((s) => s.beat),
    measures: window.__sticktrack.timeline.measures.map((m) => m.startBeat),
  }))
  await browser.close()

  // --- 1. Audio drift: scheduled time vs. ideal time from the tempo ---------
  const PPQ = 960
  const t0 = timings[0].scheduledTime - (timings[0].ticks / PPQ) * (60 / BPM)
  const barOf = (stepIndex) => {
    const beat = steps[stepIndex]
    let bar = 0
    while (bar + 1 < measures.length && measures[bar + 1] <= beat + 1e-6) bar++
    return bar + 1
  }

  // --- 3. Onsets in the rendered audio: a slice much louder than the ~6 ms before it.
  const slices = []
  for (let i = 0; i < tap.length; i += 2) slices.push({ t: tap[i] / sampleRate, peak: tap[i + 1] })
  const onsets = []
  const LOOKBACK = 16
  for (let i = LOOKBACK; i < slices.length; i++) {
    let before = 0
    for (let k = i - LOOKBACK; k < i; k++) before = Math.max(before, slices[k].peak)
    if (slices[i].peak > 0.03 && slices[i].peak > 2 * before) {
      if (!onsets.length || slices[i].t - onsets[onsets.length - 1] > 0.05) onsets.push(slices[i].t)
    }
  }
  const nearestOnset = (t) => {
    let best = Infinity
    for (const o of onsets) if (Math.abs(o - t) < Math.abs(best)) best = o - t
    return best
  }

  const perBar = new Map()
  for (const t of timings) {
    const bar = barOf(t.stepIndex)
    const ideal = t0 + (t.ticks / PPQ) * (60 / BPM)
    const row = perBar.get(bar) ?? { drift: [], visual: [], audio: [] }
    row.drift.push((t.scheduledTime - ideal) * 1000)
    row.visual.push((t.drawnAt - t.scheduledTime) * 1000)
    const o = nearestOnset(t.scheduledTime)
    if (Math.abs(o) < 0.03) row.audio.push(o * 1000)
    perBar.set(bar, row)
  }
  const pct = (xs, p) => {
    const sorted = xs.map(Math.abs).sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const fmt = (xs) => (xs.length ? `${mean(xs).toFixed(1).padStart(6)} / ${pct(xs, 0.95).toFixed(1).padStart(5)}` : '   n/a')
  console.log(`Drift check — ${timings.length} cursor moves, ${onsets.length} audio onsets detected, ${BPM} BPM`)
  console.log('bar | audio drift ms (mean/p95) | cursor vs audio ms (mean/p95) | rendered onset vs cursor ms (mean/p95)')
  for (const [bar, row] of [...perBar.entries()].sort((a, b) => a[0] - b[0])) {
    if (bar <= 2 || bar % 4 === 0 || bar >= 31)
      console.log(`${String(bar).padStart(3)} | ${fmt(row.drift).padEnd(25)} | ${fmt(row.visual).padEnd(29)} | ${fmt(row.audio)}`)
  }
  const rows = [...perBar.values()]
  const flat = (k) => rows.flatMap((r) => r[k])
  const drift = flat('drift'), visual = flat('visual'), audio = flat('audio')
  const growth = Math.abs(mean(perBar.get(32).visual) - mean(perBar.get(1).visual))
  const late = visual.filter((v) => Math.abs(v) > 17).length
  console.log('')
  console.log(`audio drift:        max ${pct(drift, 1).toFixed(3)} ms over all 32 bars`)
  console.log(`cursor vs audio:    mean ${mean(visual).toFixed(1)} ms, p95 ${pct(visual, 0.95).toFixed(1)} ms, max ${pct(visual, 1).toFixed(1)} ms (${late} of ${visual.length} moves more than one 60 Hz frame off)`)
  console.log(`rendered audio:     onsets match the cursor with median ${pct(audio, 0.5).toFixed(1)} ms, p95 ${pct(audio, 0.95).toFixed(1)} ms (${audio.length} matched)`)
  console.log(`drift bar 1 → 32:   cursor offset changed by ${growth.toFixed(1)} ms`)
  const pass = pct(drift, 1) < 1 && pct(visual, 0.95) < 17 && growth < 5 && pct(audio, 0.5) < 5 && perBar.get(32).audio.length > 0
  if (errors.length) console.log('page errors:', errors)
  console.log(pass ? 'PASS: cursor, lights and audio stay locked through bar 32' : 'FAIL')
  process.exit(pass ? 0 : 1)
})()

/**
 * Unrolling repeats: turn the written order of measures into the order they
 * are actually played.
 *
 *   written:   |: A  B  |1. C  :|2. D  | E
 *   played:       A  B     C      A  B    D  E
 *
 * Supported: forward/backward repeat barlines (with an optional "times"
 * count) and numbered endings (voltas). Not supported yet: D.S., D.C., Coda,
 * Fine — those are rarer in drum parts and need jump-text parsing.
 *
 * OSMD's cursor follows the same rules, which keeps the moving cursor and
 * our timeline in agreement.
 */

export interface RepeatMarks {
  /** Measure starts with a forward repeat |: */
  forward: boolean
  /** Measure ends with a backward repeat :| */
  backward: boolean
  /** Total number of passes for a backward repeat (MusicXML "times"), default 2. */
  times: number
  /** If this measure is inside an ending bracket, the pass numbers it is played on. */
  endings: number[] | null
}

export function unrollRepeats(marks: RepeatMarks[]): number[] {
  const order: number[] = []
  let sectionStart = 0 // where a backward repeat jumps back to
  let pass = 1 // which time through the current repeated section we're on
  let leavingRepeat = false // just finished a repeat; reset at the next measure outside an ending
  const jumpsTaken = new Map<number, number>()

  let i = 0
  let guard = 0
  const maxSteps = marks.length * 50 + 100 // protects against malformed files
  while (i < marks.length && guard++ < maxSteps) {
    const m = marks[i]

    // Once we leave the endings that follow a finished repeat, start fresh.
    if (leavingRepeat && !m.endings) {
      leavingRepeat = false
      pass = 1
      sectionStart = i
    }
    // A forward repeat reached by playing forward (not by jumping back) opens a new section.
    if (m.forward && i !== sectionStart) {
      sectionStart = i
      pass = 1
    }
    // Skip ending brackets that aren't for this pass (e.g. the "1." bar on pass 2).
    if (m.endings && !m.endings.includes(pass)) {
      i++
      continue
    }

    order.push(i)

    if (m.backward) {
      const taken = jumpsTaken.get(i) ?? 0
      if (taken < m.times - 1) {
        jumpsTaken.set(i, taken + 1)
        pass++
        i = sectionStart
        continue
      }
      jumpsTaken.set(i, 0)
      leavingRepeat = true
    }
    i++
  }
  return order
}

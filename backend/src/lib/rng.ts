// Mulberry32 — small, fast, seedable PRNG. All randomness across the project
// (engine, generators, career) must go through this so matches and procgen
// are reproducible from a seed.

export type RNG = {
  next(): number // returns [0, 1)
  int(min: number, max: number): number // inclusive bounds
  pick<T>(items: readonly T[]): T
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T
  chance(probability: number): boolean
  seed: number
  // Snapshot the internal state — needed by the pause system so a match
  // can be serialised mid-flight and resumed (across a network round-trip,
  // page reload, or save game) with the same RNG stream.
  getState(): number
  // Restore a previously snapshotted state. Engine writes this back into
  // MatchState.rngState every beat so a paused match's snapshot is
  // sufficient to resume.
  setState(s: number): void
}

// Build an RNG from a 32-bit seed. Same seed → same stream of values. The
// returned RNG also exposes getState/setState so pause/resume can preserve
// the exact stream across a serialisation boundary.
export function createRng(seed: number, initialState?: number): RNG {
  let state = (initialState ?? seed) >>> 0
  if (state === 0) state = 1

  // Mulberry32 step — advance state and return a float in [0, 1).
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    seed,
    next,
    // Random integer in [min, max] inclusive.
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min
    },
    // Uniform pick from an array.
    pick<T>(items: readonly T[]) {
      return items[Math.floor(next() * items.length)]
    },
    // Pick item with probability proportional to its weight.
    weightedPick<T>(items: readonly T[], weights: readonly number[]) {
      const total = weights.reduce((a, b) => a + b, 0)
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i]
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    },
    // True with the given probability (0–1).
    chance(probability) {
      return next() < probability
    },
    getState() {
      return state
    },
    setState(s) {
      state = s >>> 0
      if (state === 0) state = 1
    }
  }
}

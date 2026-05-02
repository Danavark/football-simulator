// Momentum tracking — a single -20..+20 number that biases possession
// and chance quality. Positive = home momentum.

import { SIM_CONSTANTS } from '~/consts/engine'

// Keep momentum within the configured ±range.
export function clampMomentum(m: number): number {
  return Math.max(SIM_CONSTANTS.MOMENTUM_MIN, Math.min(SIM_CONSTANTS.MOMENTUM_MAX, m))
}

// Decay momentum each beat so swings don't lock in permanently.
export function decayMomentum(m: number): number {
  return m * (1 - SIM_CONSTANTS.MOMENTUM_DECAY)
}

// Adjust momentum from home's perspective. Positive delta = good for home.
export function adjustMomentumForHome(current: number, delta: number): number {
  return clampMomentum(current + delta)
}

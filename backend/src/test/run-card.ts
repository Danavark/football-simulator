// Generate and print N random cards. Useful for eyeballing the pool while
// tuning the generator.
//
// Usage:
//   npx ts-node src/test/run-card.ts
//   npx ts-node src/test/run-card.ts --count 10
//   npx ts-node src/test/run-card.ts --seed 42 --count 3 --position ST
//   npx ts-node src/test/run-card.ts --tier pro --country Spain

import { generateCard } from '~/generators/card-generator'
import type { StatTier } from '~/generators/card-stats'
import { createRng } from '~/lib/rng'
import type { Card, Position } from '~/types'

type Args = {
  seed: number
  count: number
  position?: Position
  country?: string
  tier?: StatTier
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let seed = 0
  let count = 15
  let position: Position | undefined
  let country: string | undefined
  let tier: StatTier | undefined
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1]
    if (args[i] === '--seed' && next) seed = parseInt(next, 10)
    else if (args[i] === '--count' && next) count = parseInt(next, 10)
    else if (args[i] === '--position' && next) position = next as Position
    else if (args[i] === '--country' && next) country = next
    else if (args[i] === '--tier' && next) tier = next as StatTier
  }
  if (!seed || Number.isNaN(seed)) {
    seed = Math.floor(Math.random() * 0xffffffff)
  }
  return { seed, count, position, country, tier }
}

function formatCard(c: Card, index: number): string {
  const s = c.stats
  const p = c.statPotentials
  const cell = (k: keyof typeof s) => statCell(s[k], p?.[k])
  return [
    `[${index + 1}] ${c.name} (${c.country}) — ${c.position}, age ${c.age}`,
    `    PAC ${cell('pace')}  SHO ${cell('shooting')}  PAS ${cell('passing')}  DRI ${cell('dribbling')}`,
    `    DEF ${cell('defending')}  PHY ${cell('physicality')}  POS ${cell('positioning')}  STA ${cell('stamina')}`,
    `    overall ${overallCell(c)}  injuryProneness ${c.injuryProneness.toFixed(2)}  id ${c.id}`
  ].join('\n')
}

// Format one stat as "current→potential" with the arrow column-aligned so
// rows line up. Falls back to plain current when potential is missing.
function statCell(current: number, potential?: number): string {
  const cur = pad(current)
  if (potential === undefined) return `${cur}    `
  return `${cur}→${pad(potential)}`
}

// Right-pad a stat to 2 chars so columns line up.
function pad(n: number): string {
  return String(n).padStart(2, ' ')
}

// "current→potential" view of the overall — flat mean of the 8 stats vs.
// flat mean of the 8 potentials. Useful for spotting cards with lots of
// room to grow.
function overallCell(c: Card): string {
  const cur = mean(Object.values(c.stats))
  if (!c.statPotentials) return String(cur)
  const max = mean(Object.values(c.statPotentials))
  return `${cur}→${max}`
}

function mean(xs: number[]): number {
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
}

const { seed, count, position, country, tier } = parseArgs()
console.log(`seed: ${seed}`)
if (position) console.log(`position: ${position}`)
if (country) console.log(`country: ${country}`)
if (tier) console.log(`tier: ${tier}`)
console.log()

const rng = createRng(seed)
for (let i = 0; i < count; i++) {
  const card = generateCard(rng, { position, country, tier })
  console.log(formatCard(card, i))
  console.log()
}

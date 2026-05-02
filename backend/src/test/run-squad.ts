// Generate a starter squad and print its composition + best-fit formation.
// Useful for previewing the variety a new player might receive.
//
// Usage:
//   npx ts-node src/test/run-squad.ts
//   npx ts-node src/test/run-squad.ts --seed 42
//   npx ts-node src/test/run-squad.ts --seed 42 --tier pro --name "FC United"

import type { StatTier } from '@/generators/card-stats'
import { generateSquad } from '@/generators/squad-generator'
import { FORMATION_SLOTS } from '@/consts/engine'
import type { Card, Formation } from '@/types'

type Args = { seed?: number; tier?: StatTier; name?: string }

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const out: Args = {}
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1]
    if (args[i] === '--seed' && next) out.seed = parseInt(next, 10)
    else if (args[i] === '--tier' && next) out.tier = next as StatTier
    else if (args[i] === '--name' && next) out.name = next
  }
  return out
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n, ' ')
}

function overall(c: Card): number {
  const s = c.stats
  return Math.round(
    (s.pace + s.shooting + s.passing + s.dribbling + s.defending + s.physicality + s.positioning + s.stamina) / 8
  )
}

// This CLI specifically demos pack-pull mode (no formation passed), so
// formationScores is guaranteed present — assert it for the type checker.
const result = generateSquad(parseArgs())
const { squad, tactics, formationScores } = result
const slots = FORMATION_SLOTS[tactics.formation]
const cardById = new Map(squad.cards.map((c) => [c.id, c]))
const scores = formationScores!

console.log(squad.name)
console.log(`Suggested formation: ${tactics.formation}  (mentality: ${tactics.mentality})`)
console.log()

console.log('Formation fit (out of 11 starting slots filled by exact-position cards):')
const sorted = (Object.entries(scores) as [Formation, number][]).sort((a, b) => b[1] - a[1])
for (const [f, s] of sorted) console.log(`  ${pad(f, 8)}  ${s}`)
console.log()

console.log('Starting XI:')
for (const ls of squad.lineup) {
  const c = cardById.get(ls.cardId)!
  const wanted = slots[ls.slot]
  const tag = c.position === wanted ? '' : `  (out of position — card is ${c.position})`
  console.log(`  ${pad(ls.slot, 2)} ${pad(wanted, 4)}  ${pad(c.name, 24)} ovr ${overall(c)}${tag}`)
}
console.log()

console.log('Bench:')
for (const c of squad.subs) {
  console.log(`     ${pad(c.position, 4)}  ${pad(c.name, 24)} ovr ${overall(c)}`)
}

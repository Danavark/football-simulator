// Career-progression smoke test. Runs a mini-season between two teams,
// after every match: rolls auto-boosts, awards profile XP, processes
// injuries, prints deltas. Lets you eyeball the system end-to-end before
// any DB / UI is wired up.
//
// Usage:
//   npx ts-node src/test/run-progression.ts
//   npx ts-node src/test/run-progression.ts --seed 42 --matches 10

import { applyAutoBoosts, type AutoBoostEvent } from '@/career/auto-boost'
import { computeRoleBuffs, recordLegend } from '@/career/legends'
import { processSquadInjuries, type InjuryEvent } from '@/career/injuries'
import { spend, type XpPurchaseRequest } from '@/career/xp-spend'
import { awardMatchXp } from '@/career/xp'
import { testHome, testAway, testHomeTactics, testAwayTactics } from '@/test/fixtures/test-teams'
import { applyFormUpdates } from '@/engine/mechanics/form'
import { runMatch } from '@/engine/match'
import { createRng } from '@/lib/rng'
import type { Card, MatchInput, Profile, Squad } from '@/types'

function parseArgs(): { seed: number; matches: number } {
  const args = process.argv.slice(2)
  let seed = 12345
  let matches = 5
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10)
      if (!Number.isNaN(n)) seed = n
    }
    if (args[i] === '--matches' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10)
      if (!Number.isNaN(n)) matches = n
    }
  }
  return { seed, matches }
}

function findCard(squad: Squad, id: string): Card | null {
  return squad.cards.find((c) => c.id === id) ?? null
}

function statSnapshot(card: Card): string {
  const s = card.stats
  const b = card.statBoosts ?? {}
  const fmt = (k: keyof typeof s) => {
    const bonus = b[k] ?? 0
    return bonus > 0 ? `${s[k]}+${bonus}` : `${s[k]}`
  }
  return `pa:${fmt('pace')} sh:${fmt('shooting')} ps:${fmt('passing')} dr:${fmt('dribbling')} de:${fmt('defending')} ph:${fmt('physicality')} po:${fmt('positioning')} st:${fmt('stamina')}`
}

function printAutoBoosts(label: string, events: AutoBoostEvent[]): void {
  if (events.length === 0) return
  console.log(`  ${label} auto-boosts:`)
  for (const e of events) {
    console.log(`    +1 ${e.stat} → ${e.cardName} (now ${e.newValue}, total boosts ${e.newBoostCount})`)
  }
}

function printInjuries(label: string, events: InjuryEvent[]): void {
  if (events.length === 0) return
  console.log(`  ${label} injuries:`)
  for (const e of events) {
    if (e.matchesOut === 0) {
      console.log(`    knock — ${e.cardName} (no carryover)`)
    } else {
      console.log(`    ${e.severity} — ${e.cardName} out for ${e.matchesOut} match${e.matchesOut > 1 ? 'es' : ''}`)
    }
  }
}

function main(): void {
  const { seed, matches } = parseArgs()
  const rng = createRng(seed)

  // Profile owned by the user (treating testHome as their team).
  const profile: Profile = {
    id: 'smoke-profile',
    displayName: 'Smoke Test Manager',
    xpBalance: 0,
    totalXpEarned: 0,
    legends: []
  }

  console.log(`\nProgression smoke test — ${matches} matches, seed ${seed}\n`)

  for (let i = 1; i <= matches; i++) {
    const input: MatchInput = {
      homeSquad: testHome,
      awaySquad: testAway,
      homeTactics: testHomeTactics,
      awayTactics: testAwayTactics,
      seed: seed + i * 1000,
      // User is the home team — feed their legend buffs in.
      homeLegendBuffs: computeRoleBuffs(profile)
    }
    const result = runMatch(input)

    console.log(
      `Match ${i}: ${result.homeName} ${result.score.home} - ${result.score.away} ${result.awayName} (${result.weather})`
    )

    // Post-match progression order:
    //   form → auto-boost → injuries → XP earn
    applyFormUpdates(testHome, testAway, result)

    const homeBoosts = applyAutoBoosts(testHome, result, 'home', rng)
    const awayBoosts = applyAutoBoosts(testAway, result, 'away', rng)
    printAutoBoosts(result.homeName, homeBoosts)
    printAutoBoosts(result.awayName, awayBoosts)

    const homeInjuries = processSquadInjuries(testHome, result, 'home', rng)
    const awayInjuries = processSquadInjuries(testAway, result, 'away', rng)
    printInjuries(result.homeName, homeInjuries)
    printInjuries(result.awayName, awayInjuries)

    const xp = awardMatchXp(profile, result, 'home')
    console.log(
      `  XP: +${xp.net} (rates ${xp.ratings} • goals ${xp.goals} • assists ${xp.assists} • cs ${xp.cleanSheet} • result ${xp.result} • base ${xp.appearance} | conceded -${xp.goalsConceded} • yel -${xp.yellows} • red -${xp.reds} • foul -${xp.fouls})  balance ${profile.xpBalance}`
    )
  }

  // Demo XP spend — pick a goalscorer and bump their shooting if they have it.
  console.log(`\nXP spend demo`)
  const homeContext = {
    findCard: (id: string) => findCard(testHome, id)
  }
  const candidate = testHome.cards.find(
    (c) => (c.statPotentials?.shooting ?? 99) > c.stats.shooting + (c.statBoosts?.shooting ?? 0)
  )
  if (candidate) {
    const req: XpPurchaseRequest = {
      kind: 'stat_upgrade',
      cardId: candidate.id,
      stat: 'shooting'
    }
    const res = spend(profile, req, homeContext)
    console.log(`  upgrade attempt for ${candidate.name}: ${JSON.stringify(res)}`)
  }

  // Demo legend creation — retire the oldest card and check buff applies.
  console.log(`\nLegend demo`)
  const oldest = [...testHome.cards].sort((a, b) => b.age - a.age)[0]
  const legend = recordLegend(profile, oldest, 1)
  console.log(
    `  retired ${oldest.name} (${oldest.position}) → legend in ${legend.role}, buff +${(legend.buffPct * 100).toFixed(0)}%`
  )
  const buffs = computeRoleBuffs(profile)
  console.log(
    `  current role buffs: GK ${buffs.GK.toFixed(3)} • DEF ${buffs.DEF.toFixed(3)} • MID ${buffs.MID.toFixed(3)} • ATT ${buffs.ATT.toFixed(3)}`
  )

  // Final state snapshot.
  console.log(
    `\nFinal profile: balance ${profile.xpBalance} • lifetime ${profile.totalXpEarned} • legends ${profile.legends.length}`
  )
  console.log(`\n${testHome.name} stats after season:`)
  for (const c of testHome.cards.slice(0, 5)) {
    console.log(`  ${c.name.padEnd(22)} ${c.position.padEnd(4)} ${statSnapshot(c)}`)
  }
}

main()

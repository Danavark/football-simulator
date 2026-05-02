// Extensible XP-spend system. The user's profile holds an XP balance.
// They can spend it on different kinds of "purchases" — stat upgrades,
// injury heals, more in future (training, scouting, etc.). Each purchase
// kind is a discriminated-union variant with two pure functions:
//
//   • costFor(req, ctx)  — what would this cost? null if request is invalid.
//   • spend(profile, req, ctx) — validate balance + apply, mutate profile.
//
// Adding a new purchase type:
//   1. add a variant to XpPurchaseRequest
//   2. add a `case` in costFor + spend dispatchers
//   3. add a handler module (or inline if small)
//
// Spec: docs/06_progression-and-balance.md §2 (stat upgrade), §5 (heal).

import { applyStatBoost, statAtPotential } from '@/career/auto-boost'
import { PROGRESSION_CONSTANTS } from '@/consts/career'
import type { Card, Profile, Stats } from '@/types'

// Discriminated union — every purchase kind is a variant. Easy to extend.
export type XpPurchaseRequest =
  | { kind: 'stat_upgrade'; cardId: string; stat: keyof Stats }
  | { kind: 'heal_injury'; cardId: string }

// Context the dispatcher needs to look up referenced cards. Passed in by
// the caller (career layer / API route) so this module stays decoupled
// from any storage choice.
export type PurchaseContext = {
  // Resolves a card id to the live card object the request refers to.
  // Returning null means "not found / not on this profile's team".
  findCard: (cardId: string) => Card | null
}

// Result of a spend attempt. `ok: false` carries a human-readable reason
// — the API route can pass it straight to the client.
export type XpPurchaseResult =
  | {
      ok: true
      cost: number
      profileXpAfter: number
      effect: string // short description for UI / logs
    }
  | { ok: false; reason: string }

// What would this cost the user right now? Pure: no mutation, no balance
// check. Returns null when the request itself is malformed (unknown card,
// stat already at potential, no active injury).
export function costFor(req: XpPurchaseRequest, ctx: PurchaseContext): number | null {
  switch (req.kind) {
    case 'stat_upgrade':
      return statUpgradeCost(req, ctx)
    case 'heal_injury':
      return healInjuryCost(req, ctx)
  }
}

// Charge the profile and apply the effect. Validates request, checks
// balance, then dispatches to the per-kind handler. On success returns
// the new balance; on failure returns a reason string.
export function spend(profile: Profile, req: XpPurchaseRequest, ctx: PurchaseContext): XpPurchaseResult {
  const cost = costFor(req, ctx)
  if (cost === null) return { ok: false, reason: 'invalid request' }
  if (profile.xpBalance < cost) {
    return {
      ok: false,
      reason: `insufficient xp (need ${cost}, have ${profile.xpBalance})`
    }
  }

  switch (req.kind) {
    case 'stat_upgrade':
      return applyStatUpgrade(profile, req, ctx, cost)
    case 'heal_injury':
      return applyHealInjury(profile, req, ctx, cost)
  }
}

// ── stat_upgrade ──────────────────────────────────────────────────────────

function statUpgradeCost(req: { cardId: string; stat: keyof Stats }, ctx: PurchaseContext): number | null {
  const card = ctx.findCard(req.cardId)
  if (!card) return null
  if (statAtPotential(card, req.stat)) return null
  const current = card.stats[req.stat] + (card.statBoosts?.[req.stat] ?? 0)
  for (const tier of PROGRESSION_CONSTANTS.upgradeCosts) {
    if (current <= tier.upTo) return tier.cost
  }
  return null
}

function applyStatUpgrade(
  profile: Profile,
  req: { cardId: string; stat: keyof Stats },
  ctx: PurchaseContext,
  cost: number
): XpPurchaseResult {
  const card = ctx.findCard(req.cardId)!
  applyStatBoost(card, req.stat)
  profile.xpBalance -= cost
  const newValue = card.stats[req.stat] + (card.statBoosts?.[req.stat] ?? 0)
  return {
    ok: true,
    cost,
    profileXpAfter: profile.xpBalance,
    effect: `${card.name}: ${req.stat} → ${newValue}`
  }
}

// ── heal_injury ───────────────────────────────────────────────────────────

function healInjuryCost(req: { cardId: string }, ctx: PurchaseContext): number | null {
  const card = ctx.findCard(req.cardId)
  if (!card) return null
  if (card.injuryStatus !== 'injured') return null
  const sev = card.injurySeverity
  if (!sev || sev === 'knock') return null // knocks heal naturally, not buyable
  return PROGRESSION_CONSTANTS.healCosts[sev]
}

function applyHealInjury(
  profile: Profile,
  req: { cardId: string },
  ctx: PurchaseContext,
  cost: number
): XpPurchaseResult {
  const card = ctx.findCard(req.cardId)!
  card.injuryStatus = 'active'
  card.injurySeverity = undefined
  card.injuryReturnsAfterMatch = undefined
  profile.xpBalance -= cost
  return {
    ok: true,
    cost,
    profileXpAfter: profile.xpBalance,
    effect: `${card.name} healed and available next match`
  }
}

// Base prose pools — the bulk of the per-beat commentary output. Pools
// are split by outcome (nothing / buildup / chance / goal / save /
// off-target / foul). 15 lines each per Q26.
//
// Voice note: goal lines are deliberately amped (caps + exclamations)
// because Q17/Q18 wired big-moment register into the GOAL pool itself.

import type { ZonePhrase } from '~/commentary/zone-phrase'

// "Nothing" — possession lost, attack came to nothing.
export const NOTHING_LINES: ((atkName: string, z: ZonePhrase) => string)[] = [
  (a, z) => `${a} ${z.push}, but the move breaks down.`,
  (a, z) => `${a} probe ${z.through} but find no way through.`,
  (a, z) => `${a}'s ${z.noun} fizzles out.`,
  (a, z) => `${a} push ${z.through} — cleared by the defence.`,
  (a, z) => `${a} work it ${z.through} but lose possession to a strong tackle.`,
  (a, z) => `${a} look for an opening ${z.through} but find none.`,
  (a, z) => `${a} try the ${z.noun} — possession lost cheaply.`,
  (a, z) => `${a} circulate ${z.through}, then back to safety.`,
  (a, z) => `${a} string passes together ${z.through} but the move stalls.`,
  (a, z) => `${a} are crowded out ${z.through}.`,
  (a, z) => `${a} ${z.push} — defence stands firm.`,
  (a, z) => `${a} attempt the ${z.noun} but the final pass is overhit.`,
  (a, z) => `${a} run into traffic ${z.through}.`,
  (a, z) => `${a} build ${z.through} but the cross is cut out.`,
  (a, z) => `${a} threaten ${z.through} — and it's smothered by the defence.`
]

// "Buildup" — promising attack but no clear chance produced.
export const BUILDUP_LINES: ((atkName: string, z: ZonePhrase) => string)[] = [
  (a, z) => `${a} build promisingly ${z.through}.`,
  (a, z) => `${a} keep possession well ${z.through}.`,
  (a, z) => `${a} probe patiently ${z.through}.`,
  (a, z) => `${a} look dangerous ${z.through}.`,
  (a, z) => `${a} stretch the play ${z.through}.`,
  (a, z) => `${a} threaten ${z.through} but can't quite find the killer ball.`,
  (a, z) => `${a} put together a nice move ${z.through}.`,
  (a, z) => `${a} work it forward ${z.through} — they're growing into this.`,
  (a, z) => `${a} push hard ${z.through}, forcing the defence back.`,
  (a, z) => `${a} make inroads ${z.through}.`,
  (a, z) => `${a} fashion something ${z.through} — defence on the back foot.`,
  (a, z) => `${a} ${z.push} with intent.`,
  (a, z) => `${a} test the defence ${z.through}.`,
  (a, z) => `${a} get bodies forward ${z.through}.`,
  (a, z) => `${a} carve their way ${z.through} — promising.`
]

// Lead-in line when a chance is created (before the shot resolves).
export const CHANCE_LINES: ((atkName: string, quality: string, z: ZonePhrase) => string)[] = [
  (a, q, z) => `${a} carve out ${q} ${z.through}.`,
  (a, q, z) => `${a} create ${q} ${z.through}.`,
  (a, q, z) => `${a} fashion ${q} ${z.through}.`,
  (a, q, z) => `${a} engineer ${q} ${z.through}.`,
  (a, q, z) => `${a} work ${q} ${z.through}.`,
  (a, q, z) => `${a} open up ${q} ${z.through}.`,
  (a, q, z) => `${a} manufacture ${q} ${z.through}.`,
  (a, q, z) => `${a} produce ${q} ${z.through}.`,
  (a, q, z) => `${a} prise open ${q} ${z.through}.`,
  (a, q, z) => `${a} conjure ${q} ${z.through}.`,
  (a, q, z) => `${a} stitch together ${q} ${z.through}.`,
  (a, q, z) => `${a} get ${q} ${z.through}.`,
  (a, q, z) => `${a} build ${q} ${z.through}.`,
  (a, q, z) => `${a} unlock ${q} ${z.through}.`,
  (a, q, z) => `${a} put together ${q} ${z.through}.`
]

// Goal celebrations — amped voice for the big moment. Team name attaches
// at the end so the reader knows who scored even when the shooter is a
// random procedural name.
export const GOAL_LINES: ((shooter: string, team: string) => string)[] = [
  (s, t) => `⚽ GOAL — ${s} (${t}) finishes!`,
  (s, t) => `⚽ GOAL! ${s} buries it for ${t}!`,
  (s, t) => `⚽ GOAL — ${s} slots it home. ${t} score!`,
  (s, t) => `⚽ GOAL! ${s} smashes it past the keeper — ${t}`,
  (s, t) => `⚽ GOAL — ${s} finds the corner for ${t}!`,
  (s, t) => `⚽ GOAL! ${s} converts. One for ${t}.`,
  (s, t) => `⚽ GOAL — ${s} hammers it in. ${t}!`,
  (s, t) => `⚽ GOAL! ${s} tucks it away — ${t}!`,
  (s, t) => `⚽ GOAL — ${s} rifles it home for ${t}!`,
  (s, t) => `⚽ GOAL! What a finish from ${s}. ${t} score!`,
  (s, t) => `⚽ GOAL — ${s} drills it past the keeper. ${t}!`,
  (s, t) => `⚽ GOAL! ${s} unleashes one — and it's in! ${t}!`,
  (s, t) => `⚽ GOAL — ${s} curls one in for ${t}!`,
  (s, t) => `⚽ GOAL! ${s} smashes home a beauty — ${t}!`,
  (s, t) => `⚽ GOAL — ${s} sweeps it in. ${t}`
]

// Goalkeeper saves.
export const SAVE_LINES: ((shooter: string, gk: string) => string)[] = [
  (s, gk) => `${s} forces a save from ${gk}.`,
  (s, gk) => `${gk} is equal to ${s}'s effort.`,
  (s, gk) => `${gk} parries ${s}'s shot.`,
  (s, gk) => `${s}'s effort is gathered safely by ${gk}.`,
  (s, gk) => `${gk} dives full-stretch to deny ${s}.`,
  (s, gk) => `${gk} pushes ${s}'s strike around the post.`,
  (s, gk) => `${gk} produces a strong save from ${s}.`,
  (s, gk) => `${gk} tips ${s}'s effort over the bar.`,
  (s, gk) => `${gk} plunges low to keep out ${s}.`,
  (s, gk) => `Brilliant from ${gk} — ${s} thought he had it.`,
  (s, gk) => `${gk} beats away ${s}'s shot.`,
  (s, gk) => `${gk} reads it well, smothering ${s}'s effort.`,
  (s, gk) => `${gk} stands tall — ${s}'s shot kept out.`,
  (s, gk) => `${gk} blocks bravely from ${s}.`,
  (s, gk) => `Big save from ${gk} to deny ${s}.`
]

// Off-target shots.
export const OFF_TARGET_LINES: ((shooter: string) => string)[] = [
  (s) => `${s} is wide of the target.`,
  (s) => `${s} blazes it over the bar.`,
  (s) => `${s} fires inches wide.`,
  (s) => `${s} drags it well off-target.`,
  (s) => `${s} rattles the post — but no goal.`,
  (s) => `${s}'s effort flashes past the post.`,
  (s) => `${s} pulls it wide.`,
  (s) => `${s} skies it over.`,
  (s) => `${s} sends it sailing over the crossbar.`,
  (s) => `${s} clips the woodwork — close!`,
  (s) => `${s} scuffs it harmlessly wide.`,
  (s) => `${s} leans back and balloons it over.`,
  (s) => `${s} shanks the shot wide.`,
  (s) => `${s} slices it well off-target.`,
  (s) => `${s} pulls the trigger — but it's well wide.`
]

// Foul descriptions.
export const FOUL_LINES: ((fouler: string, victim: string) => string)[] = [
  (f, v) => `Foul by ${f} on ${v}.`,
  (f, v) => `${f} clatters into ${v}.`,
  (f, v) => `${f} takes down ${v} — referee blows the whistle.`,
  (f, v) => `${f} clips the heels of ${v}.`,
  (f, v) => `${f} pulls back ${v}. Free kick.`,
  (f, v) => `${f} catches ${v} late.`,
  (f, v) => `${f} barges into ${v}. Whistle.`,
  (f, v) => `${f} hauls down ${v} — whistle goes.`,
  (f, v) => `${f} sticks a leg in on ${v} — referee not happy.`,
  (f, v) => `Crude challenge from ${f} on ${v}.`,
  (f, v) => `${f} clips ${v} from behind.`,
  (f, v) => `${f} fouls ${v} — silly challenge.`,
  (f, v) => `${f} brings down ${v} with a sliding tackle.`,
  (f, v) => `${f} mistimes a tackle on ${v}.`,
  (f, v) => `${f} bundles ${v} over.`
]

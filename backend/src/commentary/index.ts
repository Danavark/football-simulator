// Commentary module — public API. Render layer over BeatResult events;
// stateful, deterministic per engine seed. See commentator.ts for the
// architecture decisions and docs/03_systems.md §2.5 for the spec.

export { createCommentator, type Commentator } from '@/commentary/commentator'
export { zonePhrase, type ZonePhrase } from '@/commentary/zone-phrase'

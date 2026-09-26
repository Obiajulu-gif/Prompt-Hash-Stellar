export interface RankingCandidate { id: string; relevance: number; quality: number; trust: number; freshness: number; flagged?: boolean; hidden?: boolean; lowTrust?: boolean }
export function rankPublicPrompts(items: RankingCandidate[]): RankingCandidate[] {
  return items.filter((x) => !x.flagged && !x.hidden && !x.lowTrust).sort((a, b) => (b.relevance * .5 + b.quality * .2 + b.trust * .2 + b.freshness * .1) - (a.relevance * .5 + a.quality * .2 + a.trust * .2 + a.freshness * .1) || a.id.localeCompare(b.id));
}

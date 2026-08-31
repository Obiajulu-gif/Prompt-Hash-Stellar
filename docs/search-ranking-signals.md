# Search Ranking Signals and Weights

This document describes the ranking algorithm used for prompt search and discovery (#734).

## Ranking Philosophy

The search ranking engine prioritizes:

1. **Relevance** - How well the prompt matches the user's search query
2. **Quality** - Verified creators and prompts with proven track records
3. **Freshness** - Recently updated and actively maintained listings
4. **Activity** - Prompts with recent successful purchases

## Text Relevance Weights

Prompts are scored based on where search terms appear:

| Signal                  | Weight | Description                                  |
| ----------------------- | ------ | -------------------------------------------- |
| Exact title match       | 100    | Search query exactly matches prompt title    |
| Title starts with query | 80     | Prompt title begins with search query        |
| Title contains query    | 60     | Search query appears anywhere in title       |
| Category match          | 40     | Query matches or appears in category         |
| Selected category bonus | 20     | Prompt matches user's active category filter |
| Preview text match      | 20     | Query appears in preview/description         |
| Description match       | 15     | Query appears in full description            |
| Creator name match      | 10     | Query matches creator username               |
| Tag match               | 10     | Query matches one of the prompt's tags       |

## Quality and Activity Boosts

Additional points awarded for quality signals:

| Signal           | Boost | Description                             |
| ---------------- | ----- | --------------------------------------- |
| Verified creator | +15   | Prompt creator has verified status      |
| Has sales        | +10   | Prompt has at least one successful sale |

## Freshness Decay (#734)

Stale listings receive score penalties to prioritize fresh content:

### Age-Based Decay

| Age        | Multiplier | Impact                  |
| ---------- | ---------- | ----------------------- |
| < 30 days  | 1.0×       | No penalty - full score |
| 30-90 days | 0.7×       | 30% score reduction     |
| > 90 days  | 0.4×       | 60% score reduction     |

Age is calculated from the most recent of:

- Last listing update (`updatedAt`)
- Listing creation date (`createdAt`)

### Activity-Based Penalty

| Condition               | Multiplier | Impact                 |
| ----------------------- | ---------- | ---------------------- |
| No sales + >30 days old | 0.9×       | Additional 10% penalty |

Combines with age decay, so a 90-day-old listing with no sales receives both penalties: `0.4 × 0.9 = 0.36` (64% total reduction).

## Ranking Behavior Examples

### Example 1: Fresh Verified Listing

**Prompt:** "React Component Generator" (created 10 days ago, verified, 5 sales)

- Title exact match: 100 points
- Verified boost: +15 points
- Has sales boost: +10 points
- Freshness multiplier: 1.0×
- **Final score: 125 points**

### Example 2: Stale Unverified Listing

**Prompt:** "React Helper" (created 100 days ago, not verified, 0 sales)

- Title contains "react": 60 points
- No quality boosts: 0 points
- Age penalty (>90 days): ×0.4
- No sales penalty: ×0.9
- **Final score: 60 × 0.4 × 0.9 = 22 points**

### Example 3: When Equal Relevance

Two prompts both match "python script":

- **Prompt A:** Updated 5 days ago, verified → Score: 60 × 1.0 + 15 = 75
- **Prompt B:** Updated 60 days ago, not verified → Score: 60 × 0.7 = 42

Fresher verified listings rank higher when text relevance is equal.

## Implementation

The ranking engine is implemented in `src/lib/search/rankingEngine.ts`:

```typescript
export function calculateRelevanceScore(
  prompt: PromptRecord,
  searchQuery: string,
  selectedCategory: string,
): RankingResult;
```

Returns:

- `score`: Final weighted score after all boosts and penalties
- `titleMatch`: Whether query matched the title
- `categoryMatch`: Whether query matched the category
- `freshnessScore`: The freshness multiplier applied (1.0 = no decay)

## Testing

Regression tests in `src/lib/search/rankingEngine.test.ts` verify:

- Text relevance scoring across all signals
- Freshness decay application
- Stale listing demotion
- Verified listing promotion
- Category filter interaction

## Configuration

Ranking weights and thresholds are centralized in `RANKING_WEIGHTS` and `FRESHNESS_THRESHOLDS` constants, making adjustments straightforward without touching scoring logic.

## Future Enhancements

Potential ranking improvements:

- Personalization based on buyer purchase history
- Trending prompts (sales velocity)
- Creator reputation scoring
- Collaborative filtering (buyers who purchased X also purchased Y)
- Seasonal/contextual boosting

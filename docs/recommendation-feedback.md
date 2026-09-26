# Recommendation Feedback Loop

## Overview

The Recommendation Feedback system learns from buyer signals and provides explicit user controls to refine marketplace recommendations.

## Feedback Actions

| Action | Effect | Scope |
|--------|--------|-------|
| `not_interested` | Record signal, may adjust recommendations | This prompt only |
| `hide_prompt` | Stop showing this prompt | User preference |
| `hide_creator` | Stop showing this creator's prompts | User preference |
| `improve_recommendations` | General feedback on quality | User feedback |

## Data Models

### RecommendationFeedback
Records every user feedback action:
```typescript
{
  userWallet: string;
  promptId?: string;
  creatorWallet?: string;
  action: FeedbackAction;
  reason?: string;
  createdAt: Date;
}
```

### UserPreferences
Tracks hidden items and preferences:
```typescript
{
  userWallet: string;
  hiddenPrompts: string[];
  hiddenCreators: string[];
  preferenceResetAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## API Endpoints

### Submit Feedback
**POST /api/recommendations/feedback**
```json
{
  "userWallet": "GUSER...",
  "promptId": "prompt-123",
  "action": "not_interested",
  "reason": "Not relevant to my workflow"
}
```

### Get User Feedback History
**GET /api/recommendations/feedback/user/:userWallet**
```json
[
  {
    "userWallet": "guser...",
    "promptId": "prompt-123",
    "action": "not_interested",
    "createdAt": "2026-09-26T..."
  }
]
```

### Get Prompt Feedback
**GET /api/recommendations/feedback/prompt/:promptId** - Aggregated feedback for a prompt

### Hide/Unhide Prompts
**POST /api/recommendations/feedback/:userWallet/hide-prompt**
```json
{
  "promptId": "prompt-123"
}
```

**POST /api/recommendations/feedback/:userWallet/unhide-prompt**
```json
{
  "promptId": "prompt-123"
}
```

### Hide/Unhide Creators
**POST /api/recommendations/feedback/:userWallet/hide-creator**
```json
{
  "creatorWallet": "GCREATOR..."
}
```

**POST /api/recommendations/feedback/:userWallet/unhide-creator**
```json
{
  "creatorWallet": "GCREATOR..."
}
```

### Get User Preferences
**GET /api/recommendations/feedback/:userWallet/preferences**
```json
{
  "hiddenPrompts": ["prompt-1", "prompt-2"],
  "hiddenCreators": ["gcreator-1"]
}
```

### Reset Preferences
**POST /api/recommendations/feedback/:userWallet/reset-preferences**

Clears all hidden prompts and creators.

### Filter Recommendations
**POST /api/recommendations/feedback/:userWallet/filter-recommendations**
```json
{
  "promptIds": ["p1", "p2", "p3", "p4"]
}
```
Response:
```json
{
  "filtered": ["p1", "p3"]
}
```

## User Journey

1. **Browse recommendations** - See personalized prompts
2. **Provide feedback** - "Not interested", "Hide creator", etc.
3. **Preferences update** - Hidden items stop appearing
4. **Explicit controls** - View/manage preferences anytime
5. **Reset anytime** - Clear preferences and start fresh

## Usage in Code

```typescript
import { recommendationFeedbackService } from "../services/recommendationFeedbackService";

// Submit feedback
await recommendationFeedbackService.submitFeedback({
  userWallet: "GUSER...",
  promptId: "prompt-123",
  action: "not_interested"
});

// Hide creator
await recommendationFeedbackService.hideCreator(
  "GUSER...",
  "GCREATOR..."
);

// Get filtered recommendations
const filtered = await recommendationFeedbackService.filterRecommendations(
  userWallet,
  recommendedPromptIds
);
```

## Privacy Guarantees

1. **No training on private content** - Feedback uses only metadata
2. **Preference control** - Users can view and reset anytime
3. **Minimal signal** - Only what user explicitly provides
4. **Transparent** - Users see what prompts/creators are hidden
5. **User ownership** - Users delete their own preferences

## Recommendation Integration

When fetching recommendations:

```typescript
// 1. Generate candidate recommendations
const candidates = await getRecommendedPrompts(userWallet);

// 2. Filter based on user preferences
const filtered = await recommendationFeedbackService
  .filterRecommendations(userWallet, candidates);

// 3. Return filtered results
return filtered;
```

## Analytics

The system tracks:

- Feedback distribution per action
- Hidden prompt/creator rates
- Preference reset frequency
- Feedback impact on engagement
- Creator performance vs feedback

## Best Practices

1. **Immediate effect** - Hidden items disappear instantly
2. **Persistent storage** - Preferences survive logout
3. **Easy controls** - One-click hide/unhide
4. **Clear feedback** - Ask for reason but don't require it
5. **Privacy first** - Minimal data collection
6. **User empowerment** - Full control over preferences
7. **Audit signals** - Log all feedback for debugging

## Example: Feedback in UI

```typescript
// When user clicks "Not Interested"
const handleNotInterested = async (promptId: string) => {
  await submitFeedback({
    userWallet: userAddress,
    promptId,
    action: "not_interested"
  });
  
  // Remove from current view
  setPrompts(prompts.filter(p => p.id !== promptId));
};

// When user clicks "Hide Creator"
const handleHideCreator = async (creatorWallet: string) => {
  await hideCreator(userAddress, creatorWallet);
  
  // Remove all from this creator
  setPrompts(prompts.filter(p => p.creator !== creatorWallet));
};
```

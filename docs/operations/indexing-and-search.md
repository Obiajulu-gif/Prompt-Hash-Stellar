# Indexing and Search System

This document describes the advanced indexing and search system for the PromptHash Stellar marketplace.

## Overview

The marketplace uses a secondary indexing layer to support advanced search, filtering, and pagination. This system:

- Listens to Soroban contract events via the indexer service
- Synchronizes prompt metadata to MongoDB
- Provides a REST API for search queries
- Supports keyword search, category filtering, price filtering, and sorting
- Includes fallback to direct contract reads if the API is unavailable

## Architecture

### Components

1. **Indexer Service** (`server/src/services/indexer.ts`)
   - Polls Stellar RPC for new ledger events
   - Processes contract events (PromptCreated, PromptPurchased, etc.)
   - Updates MongoDB with prompt data
   - Runs similarity detection on new prompts

2. **Search API** (`server/src/controllers/searchController.ts`)
   - Provides endpoints for searching prompts
   - Supports advanced filtering and pagination
   - Returns search suggestions and category counts

3. **Frontend Hooks** (`src/hooks/useSearchPrompts.ts`)
   - React Query hooks for consuming the search API
   - Automatic fallback to contract reads
   - Caching and stale-while-revalidate

### Data Flow

```
Soroban Contract → Indexer Service → MongoDB → Search API → Frontend
                                                    ↓
                                            Contract Reads (fallback)
```

## Indexer Service

### How It Works

The indexer service runs as a background process that:

1. Polls the Stellar RPC every 5 seconds for new ledgers
2. Filters events for the PromptHash contract
3. Decodes event topics and values from XDR
4. Updates MongoDB based on event type
5. Tracks the last processed ledger to avoid reprocessing

### Event Types

- **PromptCreated**: Creates or updates a prompt in MongoDB
- **PromptPurchased**: Increments the sales count
- **PromptPriceUpdated**: Updates the price
- **PromptSaleStatusUpdated**: Updates the active status

### Starting the Indexer

The indexer is currently commented out in `server/src/server.ts`. To enable it:

```typescript
import { startIndexer } from "./services/indexer";

// In the server startup code
startIndexer().catch((err: any) => {
  console.error("Failed to start Soroban Indexer:", err);
});
```

### Environment Variables

Required for the indexer:

- `PUBLIC_PROMPT_HASH_CONTRACT_ID`: The deployed contract ID
- `PUBLIC_STELLAR_RPC_URL`: Stellar RPC endpoint
- `MONGODB_URI`: MongoDB connection string

## Search API

### Endpoints

#### GET /api/search/prompts

Search prompts with advanced filtering and pagination.

**Query Parameters:**
- `query` (string): Search string for title, content, category
- `category` (string): Filter by category
- `minPrice` (number): Minimum price in XLM
- `maxPrice` (number): Maximum price in XLM
- `sortBy` (string): Sort order - `recent`, `price-low`, `price-high`, `sales`, `rating`
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)

**Response:**
```json
{
  "prompts": [...],
  "total": 100,
  "page": 1,
  "totalPages": 5,
  "hasMore": true
}
```

#### GET /api/search/suggestions

Get search suggestions based on query.

**Query Parameters:**
- `query` (string): Search string
- `limit` (number): Number of suggestions (default: 5)

**Response:**
```json
{
  "titles": ["GPT-4 Prompt", "Creative Writing"],
  "categories": ["Programming", "Creative Writing"]
}
```

#### GET /api/search/categories

Get available categories with counts.

**Response:**
```json
[
  { "name": "Programming", "count": 50 },
  { "name": "Creative Writing", "count": 30 }
]
```

#### GET /api/search/featured

Get featured/top prompts.

**Query Parameters:**
- `limit` (number): Number of prompts (default: 6)

**Response:**
```json
[
  { "title": "GPT-4 Prompt", "price": 10, "salesCount": 100 },
  ...
]
```

## Frontend Integration

### Using the Search Hooks

The frontend provides React Query hooks for consuming the search API:

```typescript
import { useSearchPrompts } from "@/hooks/useSearchPrompts";

function MyComponent() {
  const { data, isLoading, error } = useSearchPrompts({
    query: "GPT-4",
    category: "Programming",
    minPrice: 5,
    maxPrice: 50,
    sortBy: "sales",
    page: 1,
    limit: 20,
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading prompts</div>;

  return (
    <div>
      {data?.prompts.map(prompt => (
        <PromptCard key={prompt.id} prompt={prompt} />
      ))}
    </div>
  );
}
```

### Available Hooks

- `useSearchPrompts(filters, enabled)`: Search prompts with filtering
- `useSearchSuggestions(query, enabled)`: Get search suggestions
- `useCategories()`: Get categories with counts
- `useFeaturedPrompts(limit)`: Get featured prompts

### Fallback Behavior

If the search API is unavailable, the hooks automatically fall back to:

1. Direct contract reads via `getAllPrompts()`
2. Client-side filtering and sorting
3. Local pagination

This ensures the marketplace remains functional even if the indexer is down.

## Performance Considerations

### Database Indexes

The MongoDB schema includes indexes on:
- `onChainId`: For quick lookups by contract ID
- `isActive`: For filtering active prompts
- `listingStatus`: For filtering published prompts
- `title`: For text search
- `category`: For category filtering

### Caching

The frontend hooks use React Query with:
- 30-second cache for search results
- 1-minute cache for suggestions
- 5-minute cache for categories and featured prompts

### Pagination

The API supports server-side pagination to:
- Reduce response sizes
- Improve load times
- Enable infinite scroll

## Monitoring

### Health Check

The `/health` endpoint returns indexer status:

```json
{
  "status": "ok",
  "indexer": {
    "lastProcessedLedger": 12345,
    "timestamp": "2024-01-01T00:00:00Z"
  },
  "backup": { ... }
}
```

### Logs

The indexer logs:
- Event processing: `Processing Event: PromptCreated {...}`
- Errors: `Indexer Error: ...`
- Similarity scan results: `[similarity] Scan error for prompt ...`

## Troubleshooting

### Indexer Not Processing Events

1. Check that the indexer is started in `server.ts`
2. Verify `PUBLIC_PROMPT_HASH_CONTRACT_ID` is correct
3. Ensure `PUBLIC_STELLAR_RPC_URL` is accessible
4. Check MongoDB connection string

### Search API Returns Empty Results

1. Verify the indexer has processed events
2. Check that prompts have `isActive: true` and `listingStatus: "published"`
3. Ensure MongoDB has data in the `prompts` collection

### Frontend Falls Back to Contract Reads

1. Check if the API server is running
2. Verify `VITE_API_BASE_URL` environment variable
3. Check browser console for API errors
4. Ensure CORS is configured on the server

### Slow Search Performance

1. Check MongoDB indexes are created
2. Monitor query performance with MongoDB profiler
3. Consider adding Redis caching for frequent queries
4. Review pagination limits

## Scaling Considerations

For large-scale deployments:

1. **Redis Cache**: Add Redis caching layer for frequent queries
2. **Elasticsearch**: Consider Elasticsearch for advanced full-text search
3. **Horizontal Scaling**: Run multiple indexer instances with leader election
4. **Event Streaming**: Use Kafka or similar for event streaming
5. **CDN**: Cache API responses at edge locations

## Security Considerations

- API should be rate-limited to prevent abuse
- Sensitive fields (encrypted content) should not be indexed
- Validate all query parameters to prevent injection
- Use HTTPS for all API communications
- Implement authentication for admin endpoints

## Future Enhancements

Potential improvements:

1. **Full-text search**: Integrate Elasticsearch or Meilisearch
2. **Faceted search**: Add more advanced filtering options
3. **Personalization**: Rank results based on user preferences
4. **Analytics**: Track search queries and click-through rates
5. **A/B testing**: Test different ranking algorithms

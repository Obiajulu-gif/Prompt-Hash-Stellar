import { useQuery } from "@tanstack/react-query";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

interface SearchFilters {
  query?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: "recent" | "price-low" | "price-high" | "sales" | "rating";
  page?: number;
  limit?: number;
}

interface SearchResponse {
  prompts: PromptRecord[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * Hook to search prompts using the indexed search API
 * Falls back to contract reads if API is unavailable
 */
export function useSearchPrompts(filters: SearchFilters, enabled = true) {
  const {
    query = "",
    category,
    minPrice,
    maxPrice,
    sortBy = "recent",
    page = 1,
    limit = 20,
  } = filters;

  return useQuery({
    queryKey: ["search-prompts", { query, category, minPrice, maxPrice, sortBy, page, limit }],
    queryFn: async (): Promise<SearchResponse> => {
      try {
        const params = new URLSearchParams();
        if (query) params.append("query", query);
        if (category) params.append("category", category);
        if (minPrice !== undefined) params.append("minPrice", minPrice.toString());
        if (maxPrice !== undefined) params.append("maxPrice", maxPrice.toString());
        if (sortBy) params.append("sortBy", sortBy);
        if (page) params.append("page", page.toString());
        if (limit) params.append("limit", limit.toString());

        const response = await fetch(`${API_BASE_URL}/api/search/prompts?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        
        // Transform API response to match PromptRecord format
        const transformedPrompts: PromptRecord[] = data.prompts.map((p: any) => ({
          id: BigInt(p.onChainId || p._id),
          creator: p.owner?.walletAddress || p.creator || "Unknown",
          priceStroops: BigInt(Math.floor((p.price || 0) * 10_000_000)),
          title: p.title,
          category: p.category,
          previewText: p.content?.slice(0, 200) || "",
          description: p.content || "",
          tags: [],
          imageUrl: p.image || "",
          salesCount: p.salesCount || 0,
          active: p.isActive !== false,
          contentHash: p.contentHash || "",
        }));

        return {
          prompts: transformedPrompts,
          total: data.total,
          page: data.page,
          totalPages: data.totalPages,
          hasMore: data.hasMore,
        };
      } catch (error) {
        console.warn("Search API unavailable, falling back to contract reads:", error);
        // Fallback to contract reads if API fails
        const { getAllPrompts } = await import("@/lib/stellar/promptHashClient");
        const { browserStellarConfig } = await import("@/lib/stellar/browserConfig");
        
        const allPrompts = await getAllPrompts(browserStellarConfig);
        
        // Apply client-side filtering as fallback
        let filtered = allPrompts.filter((p) => p.active);
        
        if (category) {
          filtered = filtered.filter((p) => p.category === category);
        }
        
        if (query) {
          const searchLower = query.toLowerCase();
          filtered = filtered.filter((p) =>
            p.title.toLowerCase().includes(searchLower) ||
            p.category.toLowerCase().includes(searchLower) ||
            p.previewText.toLowerCase().includes(searchLower)
          );
        }
        
        if (minPrice !== undefined || maxPrice !== undefined) {
          filtered = filtered.filter((p) => {
            const price = Number(p.priceStroops) / 10_000_000;
            return (minPrice === undefined || price >= minPrice) &&
                   (maxPrice === undefined || price <= maxPrice);
          });
        }
        
        // Apply sorting
        switch (sortBy) {
          case "price-low":
            filtered.sort((a, b) => Number(a.priceStroops - b.priceStroops));
            break;
          case "price-high":
            filtered.sort((a, b) => Number(b.priceStroops - a.priceStroops));
            break;
          case "sales":
            filtered.sort((a, b) => b.salesCount - a.salesCount);
            break;
          default:
            filtered.sort((a, b) => Number(b.id - a.id));
        }
        
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedPrompts = filtered.slice(startIndex, startIndex + limit);
        
        return {
          prompts: paginatedPrompts,
          total,
          page,
          totalPages,
          hasMore: page < totalPages,
        };
      }
    },
    enabled,
    staleTime: 30_000, // Cache for 30 seconds
  });
}

/**
 * Hook to get search suggestions
 */
export function useSearchSuggestions(query: string, enabled = true) {
  return useQuery({
    queryKey: ["search-suggestions", query],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (query) params.append("query", query);
        
        const response = await fetch(`${API_BASE_URL}/api/search/suggestions?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
        console.warn("Suggestions API unavailable:", error);
        return { titles: [], categories: [] };
      }
    },
    enabled: enabled && query.length >= 2,
    staleTime: 60_000, // Cache for 1 minute
  });
}

/**
 * Hook to get categories with counts
 */
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/search/categories`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
        console.warn("Categories API unavailable:", error);
        // Fallback to default categories
        return [
          { name: "Marketing", count: 0 },
          { name: "Creative Writing", count: 0 },
          { name: "Programming", count: 0 },
          { name: "Music", count: 0 },
          { name: "Gaming", count: 0 },
          { name: "Other", count: 0 },
        ];
      }
    },
    staleTime: 300_000, // Cache for 5 minutes
  });
}

/**
 * Hook to get featured prompts
 */
export function useFeaturedPrompts(limit: number = 6) {
  return useQuery({
    queryKey: ["featured-prompts", limit],
    queryFn: async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/search/featured?limit=${limit}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Transform to match PromptRecord format
        return data.map((p: any) => ({
          id: BigInt(p.onChainId || p._id),
          creator: p.owner?.walletAddress || p.creator || "Unknown",
          priceStroops: BigInt(Math.floor((p.price || 0) * 10_000_000)),
          title: p.title,
          category: p.category,
          previewText: p.content?.slice(0, 200) || "",
          description: p.content || "",
          tags: [],
          imageUrl: p.image || "",
          salesCount: p.salesCount || 0,
          active: p.isActive !== false,
          contentHash: p.contentHash || "",
        }));
      } catch (error) {
        console.warn("Featured prompts API unavailable:", error);
        return [];
      }
    },
    staleTime: 300_000, // Cache for 5 minutes
  });
}

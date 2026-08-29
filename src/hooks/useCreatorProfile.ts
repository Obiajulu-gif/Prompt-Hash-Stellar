/**
 * React hook for loading creator profile data
 */

import { useQuery } from "@tanstack/react-query";
import { getCreatorProfile, type CreatorProfile } from "../lib/profiles/creatorProfile";

export interface UseCreatorProfileResult {
  profile: CreatorProfile | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to load creator profile data
 */
export function useCreatorProfile(address: string | undefined): UseCreatorProfileResult {
  const {
    data: profile,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["creator-profile", address],
    queryFn: () => getCreatorProfile(address!),
    enabled: Boolean(address),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    profile: profile || null,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
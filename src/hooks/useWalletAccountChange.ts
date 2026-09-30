import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from './useWallet'

/**
 * Hook that detects wallet account changes and clears wallet-scoped cache.
 * This prevents stale data from being shown when users switch accounts.
 */
export function useWalletAccountChange() {
  const { address } = useWallet()
  const queryClient = useQueryClient()
  const previousAddressRef = useRef<string | undefined>(address)

  useEffect(() => {
    // Check if address has changed
    if (address && previousAddressRef.current && address !== previousAddressRef.current) {
      // Account has switched - clear all wallet-scoped cache
      clearWalletCache(queryClient)
    }

    previousAddressRef.current = address
  }, [address, queryClient])
}

/**
 * Clears all wallet-scoped cached data from React Query.
 * Called when the user switches accounts to prevent stale data display.
 */
export function clearWalletCache(queryClient: ReturnType<typeof useQueryClient>) {
  // List of query keys that contain wallet-specific data
  const walletScopedKeys = [
    'created-prompts',     // Creator's listings
    'purchased-prompts',   // Buyer's purchases
    'saved-prompts',       // Bookmarked prompts
    'prompt-access',       // Access checks for purchased prompts
    'profile',             // User profile data
    'buyer-collections',   // Buyer's collections
    'seller-notifications',// Notifications for creators
    'user-reviews',        // User's reviews
    'wallet-balance',      // Wallet balance
  ]

  // Invalidate all wallet-scoped queries
  walletScopedKeys.forEach(key => {
    queryClient.invalidateQueries({ queryKey: [key] })
  })

  // Also cancel any in-flight requests to prevent them from overwriting fresh data
  queryClient.cancelQueries()
}

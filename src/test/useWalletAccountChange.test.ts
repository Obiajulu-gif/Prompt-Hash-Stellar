import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { clearWalletCache } from '../hooks/useWalletAccountChange'

describe('Wallet Account Change', () => {
  describe('clearWalletCache', () => {
    let queryClient: QueryClient

    beforeEach(() => {
      queryClient = new QueryClient()
    })

    it('should invalidate all wallet-scoped query keys', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')

      clearWalletCache(queryClient)

      // Check that all wallet-scoped keys were invalidated
      const walletScopedKeys = [
        'created-prompts',
        'purchased-prompts',
        'saved-prompts',
        'prompt-access',
        'profile',
        'buyer-collections',
        'seller-notifications',
        'user-reviews',
        'wallet-balance',
      ]

      expect(invalidateSpy).toHaveBeenCalledTimes(walletScopedKeys.length)

      walletScopedKeys.forEach((key) => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] })
      })

      // Should also cancel any in-flight requests
      expect(cancelSpy).toHaveBeenCalled()

      invalidateSpy.mockRestore()
      cancelSpy.mockRestore()
    })

    it('should handle multiple cache clears without errors', () => {
      expect(() => {
        clearWalletCache(queryClient)
        clearWalletCache(queryClient)
        clearWalletCache(queryClient)
      }).not.toThrow()
    })

    it('should preserve non-wallet-scoped queries', () => {
      // Add a public query that should not be affected
      queryClient.setQueryData(['search-prompts', { query: 'test' }], { results: [] })

      clearWalletCache(queryClient)

      // The public query data should still be available (though queries are invalidated)
      const cachedData = queryClient.getQueryData(['search-prompts', { query: 'test' }])
      expect(cachedData).toBeDefined()
    })
  })

  describe('Account switching scenarios', () => {
    it('should clear cache when switching from Account A to Account B', async () => {
      const queryClient = new QueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      // Simulate Account A data
      queryClient.setQueryData(['created-prompts', 'account-a'], [{ id: '1', title: 'Prompt A' }])

      // Simulate switching accounts
      clearWalletCache(queryClient)

      // Verify cache was cleared
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['created-prompts'] })

      invalidateSpy.mockRestore()
    })

    it('should handle rapid account switches', async () => {
      const queryClient = new QueryClient()
      const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')

      // Simulate rapid switches
      clearWalletCache(queryClient)
      clearWalletCache(queryClient)
      clearWalletCache(queryClient)

      // Should cancel queries to prevent race conditions
      expect(cancelSpy).toHaveBeenCalled()

      cancelSpy.mockRestore()
    })
  })
})

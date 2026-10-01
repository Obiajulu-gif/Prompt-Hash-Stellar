import { describe, it, expect } from 'vitest';
import {
  calculatePaymentBreakdown,
  xlmToStroopsBigInt,
  stroopsToXlmString,
  DEFAULT_FEE_BPS,
} from './feeCalculator';

describe('Checkout Fee Calculator & Breakdown (#455)', () => {
  it('converts XLM to Stroops and back deterministically', () => {
    expect(xlmToStroopsBigInt('10')).toBe(100_000_000n);
    expect(xlmToStroopsBigInt('2.5')).toBe(25_000_000n);
    expect(xlmToStroopsBigInt('0.0000001')).toBe(1n);

    expect(stroopsToXlmString(100_000_000n)).toBe('10');
    expect(stroopsToXlmString(25_000_000n)).toBe('2.5');
    expect(stroopsToXlmString(1n)).toBe('0.0000001');
  });

  it('calculates standard 5% platform fee (500 BPS) matching Soroban contract math', () => {
    // 10 XLM prompt price with 500 BPS (5%) => 0.5 XLM fee, 9.5 XLM creator amount
    const breakdown = calculatePaymentBreakdown('10', {
      feeBps: 500,
      asset: 'XLM',
      isAvailable: true,
    });

    expect(breakdown.isAvailable).toBe(true);
    expect(breakdown.promptPriceXlm).toBe('10');
    expect(breakdown.platformFeeXlm).toBe('0.5');
    expect(breakdown.creatorAmountXlm).toBe('9.5');
    expect(breakdown.totalChargedXlm).toBe('10');
    expect(breakdown.platformFeeStroops).toBe(5_000_000n);
    expect(breakdown.creatorAmountStroops).toBe(95_000_000n);
    expect(breakdown.totalChargedStroops).toBe(100_000_000n);
  });

  it('handles zero-fee case (0 BPS)', () => {
    const breakdown = calculatePaymentBreakdown('10', {
      feeBps: 0,
      asset: 'XLM',
      isAvailable: true,
    });

    expect(breakdown.isAvailable).toBe(true);
    expect(breakdown.platformFeeXlm).toBe('0');
    expect(breakdown.creatorAmountXlm).toBe('10');
    expect(breakdown.platformFeeStroops).toBe(0n);
    expect(breakdown.creatorAmountStroops).toBe(100_000_000n);
  });

  it('performs deterministic integer truncation matching (price * fee_bps) / 10000', () => {
    // 1 Stroop price with 500 BPS => (1 * 500) / 10000 = 0 stroops fee
    const breakdown = calculatePaymentBreakdown(1n, {
      feeBps: 500,
      asset: 'XLM',
      isAvailable: true,
    });

    expect(breakdown.platformFeeStroops).toBe(0n);
    expect(breakdown.creatorAmountStroops).toBe(1n);

    // 19 Stroops with 500 BPS => (19 * 500) / 10000 = 9500 / 10000 = 0 stroops fee
    const breakdown2 = calculatePaymentBreakdown(19n, {
      feeBps: 500,
      asset: 'XLM',
      isAvailable: true,
    });

    expect(breakdown2.platformFeeStroops).toBe(0n);
    expect(breakdown2.creatorAmountStroops).toBe(19n);

    // 20 Stroops with 500 BPS => (20 * 500) / 10000 = 10000 / 10000 = 1 stroop fee
    const breakdown3 = calculatePaymentBreakdown(20n, {
      feeBps: 500,
      asset: 'XLM',
      isAvailable: true,
    });

    expect(breakdown3.platformFeeStroops).toBe(1n);
    expect(breakdown3.creatorAmountStroops).toBe(19n);
  });

  it('blocks checkout with clear error message when fee configuration is missing or unavailable', () => {
    const breakdownMissing = calculatePaymentBreakdown('10', null);

    expect(breakdownMissing.isAvailable).toBe(false);
    expect(breakdownMissing.errorMessage).toContain('Fee configuration unavailable');

    const breakdownUnavailable = calculatePaymentBreakdown('10', {
      feeBps: DEFAULT_FEE_BPS,
      asset: 'XLM',
      isAvailable: false,
    });

    expect(breakdownUnavailable.isAvailable).toBe(false);
    expect(breakdownUnavailable.errorMessage).toContain('Fee configuration unavailable');
  });

  it('flags stale configuration when timestamp exceeds max age', () => {
    const oldTimestamp = Date.now() - 20 * 60 * 1000; // 20 mins ago
    const breakdown = calculatePaymentBreakdown('10', {
      feeBps: 500,
      asset: 'XLM',
      isAvailable: true,
      updatedAt: oldTimestamp,
    });

    expect(breakdown.isStale).toBe(true);
  });
});

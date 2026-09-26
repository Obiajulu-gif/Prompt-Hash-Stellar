#![no_std]

pub const SHARE_DENOMINATOR: u32 = 10_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoundingError {
    InvalidAmount,
    InvalidRemainder,
    SharesDoNotSumToDenominator,
    ArithmeticOverflow,
    ReserveUnderflow,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundAllocation<const N: usize> {
    pub amounts: [i128; N],
    pub remainders: [u32; N],
    pub rounding_numerator: u128,
    pub reserve_after: i128,
}

/// Allocates one settled payment against a complete set of shares.
///
/// Fractional stroops carry forward per share. Integer dust remains in the
/// reserve until a share's accumulated fraction reaches a whole stroop.
pub fn allocate_round<const N: usize>(
    payment: i128,
    shares_bps: &[u32; N],
    previous_remainders: &[u32; N],
    reserve_before: i128,
) -> Result<RoundAllocation<N>, RoundingError> {
    if payment < 0 || reserve_before < 0 {
        return Err(RoundingError::InvalidAmount);
    }

    let mut total_bps = 0u32;
    let mut total_payouts = 0i128;
    let mut rounding_numerator = 0u128;
    let mut amounts = [0i128; N];
    let mut remainders = [0u32; N];

    for index in 0..N {
        let previous_remainder = previous_remainders[index];
        if previous_remainder >= SHARE_DENOMINATOR {
            return Err(RoundingError::InvalidRemainder);
        }

        total_bps = total_bps
            .checked_add(shares_bps[index])
            .ok_or(RoundingError::ArithmeticOverflow)?;
        let share_numerator = payment
            .checked_mul(shares_bps[index] as i128)
            .ok_or(RoundingError::ArithmeticOverflow)?;
        let numerator = share_numerator
            .checked_add(previous_remainder as i128)
            .ok_or(RoundingError::ArithmeticOverflow)?;
        let payout = numerator / SHARE_DENOMINATOR as i128;
        let remainder = (numerator % SHARE_DENOMINATOR as i128) as u32;
        let newly_accrued_numerator = (share_numerator % SHARE_DENOMINATOR as i128) as u128;

        amounts[index] = payout;
        remainders[index] = remainder;
        total_payouts = total_payouts
            .checked_add(payout)
            .ok_or(RoundingError::ArithmeticOverflow)?;
        rounding_numerator = rounding_numerator
            .checked_add(newly_accrued_numerator)
            .ok_or(RoundingError::ArithmeticOverflow)?;
    }

    if total_bps != SHARE_DENOMINATOR {
        return Err(RoundingError::SharesDoNotSumToDenominator);
    }

    let reserve_after = reserve_before
        .checked_add(payment)
        .and_then(|balance| balance.checked_sub(total_payouts))
        .ok_or(RoundingError::ArithmeticOverflow)?;
    if reserve_after < 0 {
        return Err(RoundingError::ReserveUnderflow);
    }

    Ok(RoundAllocation {
        amounts,
        remainders,
        rounding_numerator,
        reserve_after,
    })
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_share_sets_and_remainders() {
        assert_eq!(
            allocate_round(1, &[9_999], &[0], 0),
            Err(RoundingError::SharesDoNotSumToDenominator)
        );
        assert_eq!(
            allocate_round(1, &[10_000], &[10_000], 1),
            Err(RoundingError::InvalidRemainder)
        );
    }

    #[test]
    fn accounts_exactly_for_tiny_skewed_allocations() {
        let bps = [9_997, 2, 1];
        let mut remainders = [0; 3];
        let mut reserve = 0;
        let mut deposited = 0;
        let mut paid = [0i128; 3];

        for payment in [1, 1, 7, 2, 1, 101, 3, 1, 19, 1] {
            let result = allocate_round(payment, &bps, &remainders, reserve).unwrap();
            deposited += payment;
            for index in 0..3 {
                paid[index] += result.amounts[index];
            }
            assert_eq!(paid.iter().sum::<i128>() + result.reserve_after, deposited);
            assert!(result.reserve_after >= 0);
            remainders = result.remainders;
            reserve = result.reserve_after;
        }

        assert_eq!(
            remainders.iter().map(|value| *value as u128).sum::<u128>(),
            reserve as u128 * SHARE_DENOMINATOR as u128
        );
    }

    #[test]
    fn simulates_thousands_of_adversarial_shares_for_hundreds_of_rounds() {
        const DEPOSITORS: usize = 2_048;
        const ROUNDS: usize = 500;

        let mut bps = [1u32; DEPOSITORS];
        bps[0] += SHARE_DENOMINATOR - DEPOSITORS as u32;

        let mut remainders = [0u32; DEPOSITORS];
        let mut paid = [0i128; DEPOSITORS];
        let mut reserve = 0i128;
        let mut total_deposited = 0i128;
        let mut random_state = 0x4d59_5df4_d0f3_3173u64;

        for round in 0..ROUNDS {
            random_state = random_state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            let payment = match round % 5 {
                0 => 1,
                1 => 2,
                2 => 101,
                3 => 10_003,
                _ => (random_state % 1_000) as i128 + 1,
            };
            let result = allocate_round(payment, &bps, &remainders, reserve).unwrap();

            total_deposited += payment;
            for index in 0..DEPOSITORS {
                paid[index] += result.amounts[index];
            }
            assert_eq!(
                paid.iter().sum::<i128>() + result.reserve_after,
                total_deposited
            );

            let aggregate_remainder = result
                .remainders
                .iter()
                .map(|value| *value as u128)
                .sum::<u128>();
            assert_eq!(
                aggregate_remainder % SHARE_DENOMINATOR as u128,
                0,
                "all share remainders must be backed by whole reserved stroops"
            );
            assert_eq!(
                aggregate_remainder / SHARE_DENOMINATOR as u128,
                result.reserve_after as u128
            );
            assert!(result.reserve_after >= 0);

            remainders = result.remainders;
            reserve = result.reserve_after;
        }

        assert_eq!(
            paid.iter().sum::<i128>() + reserve,
            total_deposited,
            "payouts and protected reserve must equal deposited assets"
        );
    }

    #[test]
    fn generated_share_distributions_preserve_conservation() {
        const DEPOSITORS: usize = 257;
        const SCENARIOS: usize = 64;
        const ROUNDS: usize = 100;
        let mut state = 0x9e37_79b9_7f4a_7c15u64;

        for _ in 0..SCENARIOS {
            let mut bps = [1u32; DEPOSITORS];
            for _ in 0..(SHARE_DENOMINATOR as usize - DEPOSITORS) {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1);
                bps[(state as usize) % DEPOSITORS] += 1;
            }

            let mut remainders = [0u32; DEPOSITORS];
            let mut reserve = 0i128;
            let mut total_deposited = 0i128;
            let mut total_paid = 0i128;

            for _ in 0..ROUNDS {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1);
                let payment = (state % 10_001) as i128;
                let result = allocate_round(payment, &bps, &remainders, reserve).unwrap();
                total_deposited += payment;
                total_paid += result.amounts.iter().sum::<i128>();
                assert_eq!(total_paid + result.reserve_after, total_deposited);
                assert!(result.reserve_after >= 0);

                remainders = result.remainders;
                reserve = result.reserve_after;
            }
        }
    }
}

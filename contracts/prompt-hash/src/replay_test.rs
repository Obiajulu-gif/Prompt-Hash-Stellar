#![cfg(test)]

//! Deterministic replay tests for multi-actor mutations on `PromptHashContract`.
//!
//! Each test defines a script of `ReplayAction`s executed by distinct actors
//! (`Admin`, `CreatorA`, `CreatorB`, `BuyerA`, `BuyerB`, `Referrer`,
//! `Collaborator`, `Attacker`). Running the same script twice against two
//! independent, freshly initialized `Env` instances must produce identical
//! step-by-step `StepOutcome` traces and identical `StateSnapshot`s (balances,
//! prompt metadata, entitlements, escrow/dispute states, and asset solvency).
//!
//! Coverage:
//! - Normal multi-actor lifecycle (create -> update/revise -> buy with splits &
//!   referrer -> settle after dispute window -> license transfer).
//! - Failure paths (insufficient payment, creator self-buy, duplicate purchase,
//!   max-supply exhaustion, settling during open dispute) verifying atomic
//!   rollback with zero state or balance drift.
//! - Retry & recovery paths (paused -> rejected -> unpaused -> retried;
//!   early settle -> `DisputeWindowNotElapsed` -> advance ledger -> retried;
//!   dispute refund -> buyer refunded & access revoked -> another buyer retries).
//! - Authorization paths using explicit `mock_auths` (no `mock_all_auths`) to
//!   verify host-enforced signer boundaries for admin, creator, and buyer
//!   mutations.
//! - Interleaved multi-actor ordering determinism (racing buyers + creator
//!   price update in two distinct orders).

extern crate std;

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::types::{
    AssetSolvency, DisputeReason, DisputeStatus, Error, ListingConfig, PromptSaleStatus,
    SettlementStatus, Split,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal, String, Vec as SorobanVec,
};
use std::vec::Vec;

const INITIAL_LEDGER_SEQ: u32 = 10_000;
const INITIAL_TIMESTAMP: u64 = 1_700_000_000;
const DISPUTE_WINDOW_SECS: u64 = 3 * 24 * 60 * 60;
const INITIAL_BUYER_BALANCE: i128 = 10_000_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Actor {
    Admin,
    CreatorA,
    CreatorB,
    BuyerA,
    BuyerB,
    Referrer,
    Collaborator,
    Attacker,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ReplayAction {
    AdvanceTime(u64),
    SetPause {
        actor: Actor,
        paused: bool,
    },
    CreatePrompt {
        creator: Actor,
        title: &'static str,
        price: i128,
        max_supply: u64,
        with_collaborator_split: bool,
    },
    UpdatePrice {
        actor: Actor,
        prompt_id: u64,
        new_price: i128,
    },
    ReviseListing {
        actor: Actor,
        prompt_id: u64,
        new_title: &'static str,
        new_price: i128,
    },
    BuyPrompt {
        buyer: Actor,
        prompt_id: u64,
        referrer: Option<Actor>,
        payment: i128,
    },
    OpenDispute {
        buyer: Actor,
        prompt_id: u64,
        reason: DisputeReason,
    },
    ResolveDispute {
        admin: Actor,
        prompt_id: u64,
        buyer: Actor,
        refund: bool,
    },
    SettlePurchase {
        caller: Actor,
        prompt_id: u64,
        buyer: Actor,
    },
    TransferLicense {
        seller: Actor,
        prompt_id: u64,
        new_buyer: Actor,
        resale_price: i128,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum StepOutcome {
    Ok,
    ContractErr(u32),
    HostErr,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PromptSnapshot {
    id: u64,
    price_stroops: i128,
    sale_status: PromptSaleStatus,
    sales_count: u64,
    revision: u32,
    max_supply: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct EscrowSnapshot {
    amount: i128,
    status: SettlementStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StateSnapshot {
    timestamp: u64,
    is_paused: bool,
    platform_fee: u32,
    prompts: Vec<PromptSnapshot>,
    balances: [i128; 9], // fee_wallet, creator_a, creator_b, buyer_a, buyer_b, referrer, collaborator, attacker, contract
    buyer_a_access: Vec<bool>,
    buyer_b_access: Vec<bool>,
    creator_b_access: Vec<bool>,
    escrows_buyer_a: Vec<Option<EscrowSnapshot>>,
    escrows_buyer_b: Vec<Option<EscrowSnapshot>>,
    disputes_buyer_a: Vec<Option<DisputeStatus>>,
    solvency: AssetSolvency,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ReplayTrace {
    outcomes: Vec<StepOutcome>,
    snapshots: Vec<StateSnapshot>,
}

struct ReplayHarness {
    env: Env,
    admin: Address,
    fee_wallet: Address,
    creator_a: Address,
    creator_b: Address,
    buyer_a: Address,
    buyer_b: Address,
    referrer: Address,
    collaborator: Address,
    attacker: Address,
    token_id: Address,
    contract_id: Address,
    created_prompts: Vec<u64>,
}

impl ReplayHarness {
    fn new(mock_all_auths: bool) -> Self {
        let env = Env::default();
        env.ledger().set_sequence_number(INITIAL_LEDGER_SEQ);
        env.ledger().set_timestamp(INITIAL_TIMESTAMP);

        if mock_all_auths {
            env.mock_all_auths();
        }

        let admin = Address::generate(&env);
        let fee_wallet = Address::generate(&env);
        let creator_a = Address::generate(&env);
        let creator_b = Address::generate(&env);
        let buyer_a = Address::generate(&env);
        let buyer_b = Address::generate(&env);
        let referrer = Address::generate(&env);
        let collaborator = Address::generate(&env);
        let attacker = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(
            PromptHashContract,
            (admin.clone(), fee_wallet.clone(), token_id.clone()),
        );

        let sac = token::StellarAssetClient::new(&env, &token_id);
        if mock_all_auths {
            sac.mint(&buyer_a, &INITIAL_BUYER_BALANCE);
            sac.mint(&buyer_b, &INITIAL_BUYER_BALANCE);
            sac.mint(&creator_b, &INITIAL_BUYER_BALANCE);
            sac.mint(&attacker, &INITIAL_BUYER_BALANCE);
        } else {
            for recipient in [&buyer_a, &buyer_b, &creator_b, &attacker] {
                env.mock_auths(&[MockAuth {
                    address: &admin,
                    invoke: &MockAuthInvoke {
                        contract: &token_id,
                        fn_name: "mint",
                        args: (recipient.clone(), INITIAL_BUYER_BALANCE).into_val(&env),
                        sub_invokes: &[],
                    },
                }]);
                sac.mint(recipient, &INITIAL_BUYER_BALANCE);
            }
        }

        Self {
            env,
            admin,
            fee_wallet,
            creator_a,
            creator_b,
            buyer_a,
            buyer_b,
            referrer,
            collaborator,
            attacker,
            token_id,
            contract_id,
            created_prompts: Vec::new(),
        }
    }

    fn addr(&self, actor: Actor) -> Address {
        match actor {
            Actor::Admin => self.admin.clone(),
            Actor::CreatorA => self.creator_a.clone(),
            Actor::CreatorB => self.creator_b.clone(),
            Actor::BuyerA => self.buyer_a.clone(),
            Actor::BuyerB => self.buyer_b.clone(),
            Actor::Referrer => self.referrer.clone(),
            Actor::Collaborator => self.collaborator.clone(),
            Actor::Attacker => self.attacker.clone(),
        }
    }

    fn client(&self) -> PromptHashContractClient<'_> {
        PromptHashContractClient::new(&self.env, &self.contract_id)
    }

    fn execute_action(&mut self, action: &ReplayAction) -> StepOutcome {
        let client = self.client();
        match action {
            ReplayAction::AdvanceTime(secs) => {
                let now = self.env.ledger().timestamp();
                self.env.ledger().set_timestamp(now + secs);
                StepOutcome::Ok
            }
            ReplayAction::SetPause { paused, .. } => {
                map_result(client.try_set_pause_status(paused))
            }
            ReplayAction::CreatePrompt {
                creator,
                title,
                price,
                max_supply,
                with_collaborator_split,
            } => {
                let creator_addr = self.addr(*creator);
                let mut splits = SorobanVec::new(&self.env);
                if *with_collaborator_split {
                    splits.push_back(Split {
                        recipient: self.collaborator.clone(),
                        bps: 2_500, // 25% of creator's net share
                    });
                }
                let res = client.try_create_prompt(
                    &creator_addr,
                    &String::from_str(&self.env, "https://example.com/prompt.png"),
                    &String::from_str(&self.env, title),
                    &String::from_str(&self.env, "Software Development"),
                    &String::from_str(&self.env, "Deterministic replay preview"),
                    &String::from_str(&self.env, "encrypted-payload"),
                    &String::from_str(&self.env, "iv-nonce"),
                    &String::from_str(&self.env, "wrapped-key"),
                    &BytesN::from_array(&self.env, &[7u8; 32]),
                    &ListingConfig {
                        price: *price,
                        asset: self.token_id.clone(),
                        expires_at: 0,
                        splits,
                        tags: SorobanVec::new(&self.env),
                        max_supply: *max_supply,
                        license_terms_hash: BytesN::from_array(&self.env, &[1u8; 32]),
                    },
                );
                match res {
                    Ok(Ok(id)) => {
                        self.created_prompts.push(id);
                        StepOutcome::Ok
                    }
                    Ok(Err(_)) => StepOutcome::HostErr,
                    Err(Ok(e)) => StepOutcome::ContractErr(e as u32),
                    Err(Err(_)) => StepOutcome::HostErr,
                }
            }
            ReplayAction::UpdatePrice {
                actor,
                prompt_id,
                new_price,
            } => {
                let actor_addr = self.addr(*actor);
                map_result(client.try_update_prompt_price(&actor_addr, prompt_id, new_price))
            }
            ReplayAction::ReviseListing {
                actor,
                prompt_id,
                new_title,
                new_price,
            } => {
                let actor_addr = self.addr(*actor);
                let res = client.try_revise_listing(
                    &actor_addr,
                    prompt_id,
                    &String::from_str(&self.env, new_title),
                    &String::from_str(&self.env, "Software Development"),
                    &String::from_str(&self.env, "Revised deterministic preview"),
                    &String::from_str(&self.env, "https://example.com/revised.png"),
                    new_price,
                );
                map_result(res)
            }
            ReplayAction::BuyPrompt {
                buyer,
                prompt_id,
                referrer,
                payment,
            } => {
                let buyer_addr = self.addr(*buyer);
                let ref_addr = referrer.map(|r| self.addr(r));
                map_result(client.try_buy_prompt(&buyer_addr, prompt_id, &ref_addr, payment, &None))
            }
            ReplayAction::OpenDispute {
                buyer,
                prompt_id,
                reason,
            } => {
                let buyer_addr = self.addr(*buyer);
                map_result(client.try_open_dispute(&buyer_addr, prompt_id, reason))
            }
            ReplayAction::ResolveDispute {
                admin,
                prompt_id,
                buyer,
                refund,
            } => {
                let admin_addr = self.addr(*admin);
                let buyer_addr = self.addr(*buyer);
                map_result(client.try_resolve_dispute(&admin_addr, prompt_id, &buyer_addr, refund))
            }
            ReplayAction::SettlePurchase {
                caller,
                prompt_id,
                buyer,
            } => {
                let caller_addr = self.addr(*caller);
                let buyer_addr = self.addr(*buyer);
                map_result(client.try_settle_purchase(&caller_addr, prompt_id, &buyer_addr))
            }
            ReplayAction::TransferLicense {
                seller,
                prompt_id,
                new_buyer,
                resale_price,
            } => {
                let seller_addr = self.addr(*seller);
                let new_buyer_addr = self.addr(*new_buyer);
                map_result(client.try_transfer_license(
                    &seller_addr,
                    prompt_id,
                    &new_buyer_addr,
                    resale_price,
                ))
            }
        }
    }

    fn snapshot(&self) -> StateSnapshot {
        let client = self.client();
        let token_client = token::Client::new(&self.env, &self.token_id);

        let mut prompts = Vec::new();
        let mut buyer_a_access = Vec::new();
        let mut buyer_b_access = Vec::new();
        let mut creator_b_access = Vec::new();
        let mut escrows_buyer_a = Vec::new();
        let mut escrows_buyer_b = Vec::new();
        let mut disputes_buyer_a = Vec::new();

        for &pid in &self.created_prompts {
            if let Ok(p) = client.try_get_prompt(&pid) {
                if let Ok(p) = p {
                    prompts.push(PromptSnapshot {
                        id: p.id,
                        price_stroops: p.price_stroops,
                        sale_status: p.sale_status,
                        sales_count: p.sales_count,
                        revision: p.revision,
                        max_supply: p.max_supply,
                    });
                }
            }
            buyer_a_access.push(client.has_access(&self.buyer_a, &pid));
            buyer_b_access.push(client.has_access(&self.buyer_b, &pid));
            creator_b_access.push(client.has_access(&self.creator_b, &pid));

            escrows_buyer_a.push(client.get_purchase_escrow(&pid, &self.buyer_a).map(|e| {
                EscrowSnapshot {
                    amount: e.amount,
                    status: e.status,
                }
            }));
            escrows_buyer_b.push(client.get_purchase_escrow(&pid, &self.buyer_b).map(|e| {
                EscrowSnapshot {
                    amount: e.amount,
                    status: e.status,
                }
            }));
            let d_status = match client.try_get_dispute(&pid, &self.buyer_a) {
                Ok(Ok(d)) => Some(d.status),
                _ => None,
            };
            disputes_buyer_a.push(d_status);
        }

        let balances = [
            token_client.balance(&self.fee_wallet),
            token_client.balance(&self.creator_a),
            token_client.balance(&self.creator_b),
            token_client.balance(&self.buyer_a),
            token_client.balance(&self.buyer_b),
            token_client.balance(&self.referrer),
            token_client.balance(&self.collaborator),
            token_client.balance(&self.attacker),
            token_client.balance(&self.contract_id),
        ];

        let solvency = client.get_asset_solvency(&self.token_id);

        StateSnapshot {
            timestamp: self.env.ledger().timestamp(),
            is_paused: client.is_paused(),
            platform_fee: client.get_platform_fee(),
            prompts,
            balances,
            buyer_a_access,
            buyer_b_access,
            creator_b_access,
            escrows_buyer_a,
            escrows_buyer_b,
            disputes_buyer_a,
            solvency,
        }
    }

    fn run_script(script: &[ReplayAction]) -> ReplayTrace {
        let mut harness = Self::new(true);
        let mut outcomes = Vec::with_capacity(script.len());
        let mut snapshots = Vec::with_capacity(script.len());
        for action in script {
            outcomes.push(harness.execute_action(action));
            snapshots.push(harness.snapshot());
        }
        ReplayTrace {
            outcomes,
            snapshots,
        }
    }
}

fn map_result<T>(
    res: Result<Result<T, soroban_sdk::ConversionError>, Result<Error, soroban_sdk::InvokeError>>,
) -> StepOutcome {
    match res {
        Ok(Ok(_)) => StepOutcome::Ok,
        Ok(Err(_)) => StepOutcome::HostErr,
        Err(Ok(e)) => StepOutcome::ContractErr(e as u32),
        Err(Err(_)) => StepOutcome::HostErr,
    }
}

/// Runs `script` twice on two completely fresh environments and asserts exact
/// replay determinism across every step outcome and every post-step snapshot.
fn assert_deterministic_replay(script: &[ReplayAction]) -> ReplayTrace {
    let run_1 = ReplayHarness::run_script(script);
    let run_2 = ReplayHarness::run_script(script);
    assert_eq!(
        run_1.outcomes, run_2.outcomes,
        "Replay step outcomes diverged between two identical runs"
    );
    assert_eq!(
        run_1.snapshots, run_2.snapshots,
        "Replay state snapshots diverged between two identical runs"
    );
    run_1
}

// ============================================================================
// 1. Normal Path: Multi-actor lifecycle replay
// ============================================================================

#[test]
fn replay_normal_multi_actor_lifecycle_is_deterministic() {
    let script = [
        // CreatorA lists a supply-capped prompt with a 25% collaborator split.
        ReplayAction::CreatePrompt {
            creator: Actor::CreatorA,
            title: "Multi-Actor Replay Prompt",
            price: 100_000_000,
            max_supply: 2,
            with_collaborator_split: true,
        },
        // CreatorA revises listing metadata and adjusts price before any sale.
        ReplayAction::ReviseListing {
            actor: Actor::CreatorA,
            prompt_id: 1,
            new_title: "Multi-Actor Replay Prompt v2",
            new_price: 200_000_000,
        },
        // BuyerA purchases with Referrer.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: Some(Actor::Referrer),
            payment: 200_000_000,
        },
        // BuyerB purchases without a referrer, exhausting max_supply = 2.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerB,
            prompt_id: 1,
            referrer: None,
            payment: 200_000_000,
        },
        // Advance past the 3-day dispute window and settle both purchases.
        ReplayAction::AdvanceTime(DISPUTE_WINDOW_SECS + 1),
        ReplayAction::SettlePurchase {
            caller: Actor::CreatorA,
            prompt_id: 1,
            buyer: Actor::BuyerA,
        },
        ReplayAction::SettlePurchase {
            caller: Actor::CreatorA,
            prompt_id: 1,
            buyer: Actor::BuyerB,
        },
        // BuyerA resells license to CreatorB.
        ReplayAction::TransferLicense {
            seller: Actor::BuyerA,
            prompt_id: 1,
            new_buyer: Actor::CreatorB,
            resale_price: 250_000_000,
        },
    ];

    let trace = assert_deterministic_replay(&script);
    assert!(
        trace.outcomes.iter().all(|o| *o == StepOutcome::Ok),
        "Expected all normal-path steps to succeed, got: {:?}",
        trace.outcomes
    );

    let final_state = trace.snapshots.last().unwrap();
    assert_eq!(final_state.prompts[0].revision, 2);
    assert_eq!(final_state.prompts[0].sales_count, 2);
    // BuyerA transferred license to CreatorB; BuyerB still owns theirs.
    assert_eq!(final_state.buyer_a_access, std::vec![false]);
    assert_eq!(final_state.buyer_b_access, std::vec![true]);
    assert_eq!(final_state.creator_b_access, std::vec![true]);
    // Both escrows settled; contract holds zero liability and remains solvent.
    assert_eq!(final_state.solvency.tracked_liability, 0);
    assert_eq!(final_state.solvency.surplus, 0);
    // Fee wallet, CreatorA, Collaborator, and Referrer all received payouts.
    assert!(final_state.balances[0] > 0, "fee_wallet should earn fees");
    assert!(final_state.balances[1] > 0, "creator_a should earn revenue");
    assert!(final_state.balances[5] > 0, "referrer should earn referral");
    assert!(
        final_state.balances[6] > 0,
        "collaborator should earn split"
    );
}

// ============================================================================
// 2. Failure Path: Atomic rollback & zero state drift on invalid mutations
// ============================================================================

#[test]
fn replay_failure_paths_preserve_state_and_are_deterministic() {
    let script = [
        // 0: CreatorA creates a prompt with max_supply = 1.
        ReplayAction::CreatePrompt {
            creator: Actor::CreatorA,
            title: "Limited Edition",
            price: 100_000_000,
            max_supply: 1,
            with_collaborator_split: false,
        },
        // 1: Failure — BuyerA underpays.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 50_000_000,
        },
        // 2: Failure — CreatorA attempts to buy their own prompt.
        ReplayAction::BuyPrompt {
            buyer: Actor::CreatorA,
            prompt_id: 1,
            referrer: None,
            payment: 100_000_000,
        },
        // 3: Success — BuyerA buys at full price.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 100_000_000,
        },
        // 4: Failure — BuyerA attempts duplicate purchase.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 100_000_000,
        },
        // 5: Failure — BuyerB attempts purchase after max_supply reached.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerB,
            prompt_id: 1,
            referrer: None,
            payment: 100_000_000,
        },
        // 6: BuyerA opens a dispute.
        ReplayAction::OpenDispute {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            reason: DisputeReason::NotAsDescribed,
        },
        // 7: Advance past dispute window, then CreatorA tries to settle while dispute is open.
        ReplayAction::AdvanceTime(DISPUTE_WINDOW_SECS + 1),
        ReplayAction::SettlePurchase {
            caller: Actor::CreatorA,
            prompt_id: 1,
            buyer: Actor::BuyerA,
        },
    ];

    let trace = assert_deterministic_replay(&script);

    assert_eq!(trace.outcomes[0], StepOutcome::Ok);
    assert_eq!(
        trace.outcomes[1],
        StepOutcome::ContractErr(Error::InvalidPaymentAmount as u32)
    );
    assert_eq!(
        trace.outcomes[2],
        StepOutcome::ContractErr(Error::CreatorCannotBuy as u32)
    );
    assert_eq!(trace.outcomes[3], StepOutcome::Ok);
    assert_eq!(
        trace.outcomes[4],
        StepOutcome::ContractErr(Error::AlreadyPurchased as u32)
    );
    assert_eq!(
        trace.outcomes[5],
        StepOutcome::ContractErr(Error::MaxSupplyReached as u32)
    );
    assert_eq!(trace.outcomes[6], StepOutcome::Ok);
    assert_eq!(trace.outcomes[7], StepOutcome::Ok);
    // Settling while an open dispute exists must fail.
    assert!(matches!(trace.outcomes[8], StepOutcome::ContractErr(_)));

    // Verify atomic rollback: failed steps 1 & 2 left state identical to step 0.
    assert_eq!(trace.snapshots[1], trace.snapshots[0]);
    assert_eq!(trace.snapshots[2], trace.snapshots[0]);
    // Failed steps 4 & 5 left state identical to step 3.
    assert_eq!(trace.snapshots[4], trace.snapshots[3]);
    assert_eq!(trace.snapshots[5], trace.snapshots[3]);
    // Failed settle at step 8 left state identical to step 7 (escrow still disputed).
    assert_eq!(trace.snapshots[8], trace.snapshots[7]);
    assert_eq!(trace.snapshots[8].solvency.tracked_liability, 100_000_000);
    assert_eq!(trace.snapshots[8].solvency.surplus, 0);
}

// ============================================================================
// 3. Retry & Recovery Path: Pause/unpause, premature settle, dispute refund
// ============================================================================

#[test]
fn replay_retry_paths_after_pause_window_and_dispute_recovery() {
    let script = [
        // 0: CreatorA creates prompt.
        ReplayAction::CreatePrompt {
            creator: Actor::CreatorA,
            title: "Retryable Prompt",
            price: 150_000_000,
            max_supply: 2,
            with_collaborator_split: false,
        },
        // 1: Admin pauses contract.
        ReplayAction::SetPause {
            actor: Actor::Admin,
            paused: true,
        },
        // 2: BuyerA attempts purchase while paused -> fails.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 150_000_000,
        },
        // 3: Admin unpauses contract.
        ReplayAction::SetPause {
            actor: Actor::Admin,
            paused: false,
        },
        // 4: BuyerA retries purchase -> succeeds.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 150_000_000,
        },
        // 5: BuyerB attempts premature settlement before dispute window elapses -> fails.
        ReplayAction::SettlePurchase {
            caller: Actor::CreatorA,
            prompt_id: 1,
            buyer: Actor::BuyerA,
        },
        // 6: BuyerA opens dispute; Admin resolves with refund = true.
        ReplayAction::OpenDispute {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            reason: DisputeReason::ContentMismatch,
        },
        ReplayAction::ResolveDispute {
            admin: Actor::Admin,
            prompt_id: 1,
            buyer: Actor::BuyerA,
            refund: true,
        },
        // 8: BuyerB purchases the prompt after BuyerA's refund.
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerB,
            prompt_id: 1,
            referrer: None,
            payment: 150_000_000,
        },
        // 9: Advance past dispute window and retry settlement for BuyerB -> succeeds.
        ReplayAction::AdvanceTime(DISPUTE_WINDOW_SECS + 1),
        ReplayAction::SettlePurchase {
            caller: Actor::CreatorA,
            prompt_id: 1,
            buyer: Actor::BuyerB,
        },
    ];

    let trace = assert_deterministic_replay(&script);

    assert_eq!(trace.outcomes[0], StepOutcome::Ok);
    assert_eq!(trace.outcomes[1], StepOutcome::Ok);
    assert_eq!(
        trace.outcomes[2],
        StepOutcome::ContractErr(Error::ContractIsPaused as u32)
    );
    assert_eq!(trace.outcomes[3], StepOutcome::Ok);
    assert_eq!(trace.outcomes[4], StepOutcome::Ok);
    assert_eq!(
        trace.outcomes[5],
        StepOutcome::ContractErr(Error::DisputeWindowNotElapsed as u32)
    );
    assert_eq!(trace.outcomes[6], StepOutcome::Ok);
    assert_eq!(trace.outcomes[7], StepOutcome::Ok);
    assert_eq!(trace.outcomes[8], StepOutcome::Ok);
    assert_eq!(trace.outcomes[9], StepOutcome::Ok);
    assert_eq!(trace.outcomes[10], StepOutcome::Ok);

    // After refund (step 7), BuyerA has full initial balance restored and no access.
    assert_eq!(trace.snapshots[7].balances[3], INITIAL_BUYER_BALANCE);
    assert_eq!(trace.snapshots[7].buyer_a_access, std::vec![false]);
    assert_eq!(
        trace.snapshots[7].disputes_buyer_a,
        std::vec![Some(DisputeStatus::Refunded)]
    );

    // After BuyerB's purchase and settlement (step 10), contract is fully solvent with 0 liability.
    let final_state = trace.snapshots.last().unwrap();
    assert_eq!(final_state.buyer_b_access, std::vec![true]);
    assert_eq!(final_state.solvency.tracked_liability, 0);
    assert_eq!(final_state.solvency.surplus, 0);
}

// ============================================================================
// 4. Authorization Path: Explicit signer enforcement without mock_all_auths
// ============================================================================

fn run_auth_replay_scenario() -> (Vec<bool>, StateSnapshot) {
    let mut h = ReplayHarness::new(false);
    let mut results = Vec::new();

    // Step 1: Attacker tries to pause contract signing as Attacker -> MUST FAIL.
    h.env.mock_auths(&[MockAuth {
        address: &h.attacker,
        invoke: &MockAuthInvoke {
            contract: &h.contract_id,
            fn_name: "set_pause_status",
            args: (true,).into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    results.push(h.client().try_set_pause_status(&true).is_ok());

    // Step 2: Admin pauses and unpauses signing as Admin -> MUST SUCCEED.
    h.env.mock_auths(&[MockAuth {
        address: &h.admin,
        invoke: &MockAuthInvoke {
            contract: &h.contract_id,
            fn_name: "set_pause_status",
            args: (true,).into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    results.push(h.client().try_set_pause_status(&true).is_ok());

    h.env.mock_auths(&[MockAuth {
        address: &h.admin,
        invoke: &MockAuthInvoke {
            contract: &h.contract_id,
            fn_name: "set_pause_status",
            args: (false,).into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    results.push(h.client().try_set_pause_status(&false).is_ok());

    // Step 3: CreatorA creates a prompt with CreatorA's auth -> MUST SUCCEED.
    let listing_cfg = ListingConfig {
        price: 100_000_000,
        asset: h.token_id.clone(),
        expires_at: 0,
        splits: SorobanVec::new(&h.env),
        tags: SorobanVec::new(&h.env),
        max_supply: 5,
        license_terms_hash: BytesN::from_array(&h.env, &[1u8; 32]),
    };
    let img = String::from_str(&h.env, "https://example.com/auth.png");
    let title = String::from_str(&h.env, "Auth Replay Prompt");
    let cat = String::from_str(&h.env, "Software Development");
    let prev = String::from_str(&h.env, "Preview");
    let enc = String::from_str(&h.env, "encrypted");
    let iv = String::from_str(&h.env, "iv");
    let wk = String::from_str(&h.env, "wrapped-key");
    let hash = BytesN::from_array(&h.env, &[9u8; 32]);

    h.env.mock_auths(&[MockAuth {
        address: &h.creator_a,
        invoke: &MockAuthInvoke {
            contract: &h.contract_id,
            fn_name: "create_prompt",
            args: (
                h.creator_a.clone(),
                img.clone(),
                title.clone(),
                cat.clone(),
                prev.clone(),
                enc.clone(),
                iv.clone(),
                wk.clone(),
                hash.clone(),
                listing_cfg.clone(),
            )
                .into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    let prompt_id = h
        .client()
        .create_prompt(&h.creator_a, &img, &title, &cat, &prev, &enc, &iv, &wk, &hash, &listing_cfg);
    h.created_prompts.push(prompt_id);
    results.push(true);

    // Step 4: Attacker tries to update CreatorA's prompt price -> MUST FAIL.
    h.env.mock_auths(&[MockAuth {
        address: &h.attacker,
        invoke: &MockAuthInvoke {
            contract: &h.contract_id,
            fn_name: "update_prompt_price",
            args: (h.attacker.clone(), prompt_id, 1_i128).into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    results.push(
        h.client()
            .try_update_prompt_price(&h.attacker, &prompt_id, &1_i128)
            .is_ok(),
    );

    // Step 5: CreatorA updates their own prompt price -> MUST SUCCEED.
    h.env.mock_auths(&[MockAuth {
        address: &h.creator_a,
        invoke: &MockAuthInvoke {
            contract: &h.contract_id,
            fn_name: "update_prompt_price",
            args: (h.creator_a.clone(), prompt_id, 175_000_000_i128).into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    results.push(
        h.client()
            .try_update_prompt_price(&h.creator_a, &prompt_id, &175_000_000_i128)
            .is_ok(),
    );

    (results, h.snapshot())
}

#[test]
fn replay_authorization_paths_enforce_actor_boundaries() {
    let (res_1, snap_1) = run_auth_replay_scenario();
    let (res_2, snap_2) = run_auth_replay_scenario();

    assert_eq!(res_1, std::vec![false, true, true, true, false, true]);
    assert_eq!(res_1, res_2, "Authorization outcomes must replay deterministically");
    assert_eq!(snap_1, snap_2, "Authorization post-state must replay deterministically");
    assert!(!snap_1.is_paused);
    assert_eq!(snap_1.prompts[0].price_stroops, 175_000_000);
}

// ============================================================================
// 5. Interleaved Multi-Actor Ordering Determinism
// ============================================================================

#[test]
fn replay_interleaved_actors_order_determinism() {
    // Order A: BuyerA buys at 100M -> CreatorA raises price to 200M -> BuyerB fails (MaxSupplyReached).
    let order_a = [
        ReplayAction::CreatePrompt {
            creator: Actor::CreatorA,
            title: "Race Prompt",
            price: 100_000_000,
            max_supply: 1,
            with_collaborator_split: false,
        },
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 100_000_000,
        },
        ReplayAction::UpdatePrice {
            actor: Actor::CreatorA,
            prompt_id: 1,
            new_price: 200_000_000,
        },
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerB,
            prompt_id: 1,
            referrer: None,
            payment: 200_000_000,
        },
    ];

    // Order B: CreatorA raises price to 200M -> BuyerB buys at 200M -> BuyerA fails (MaxSupplyReached).
    let order_b = [
        ReplayAction::CreatePrompt {
            creator: Actor::CreatorA,
            title: "Race Prompt",
            price: 100_000_000,
            max_supply: 1,
            with_collaborator_split: false,
        },
        ReplayAction::UpdatePrice {
            actor: Actor::CreatorA,
            prompt_id: 1,
            new_price: 200_000_000,
        },
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerB,
            prompt_id: 1,
            referrer: None,
            payment: 200_000_000,
        },
        ReplayAction::BuyPrompt {
            buyer: Actor::BuyerA,
            prompt_id: 1,
            referrer: None,
            payment: 200_000_000,
        },
    ];

    let trace_a = assert_deterministic_replay(&order_a);
    let trace_b = assert_deterministic_replay(&order_b);

    assert_eq!(trace_a.outcomes[1], StepOutcome::Ok);
    assert_eq!(
        trace_a.outcomes[3],
        StepOutcome::ContractErr(Error::MaxSupplyReached as u32)
    );
    assert_eq!(trace_b.outcomes[2], StepOutcome::Ok);
    assert_eq!(
        trace_b.outcomes[3],
        StepOutcome::ContractErr(Error::MaxSupplyReached as u32)
    );

    let final_a = trace_a.snapshots.last().unwrap();
    let final_b = trace_b.snapshots.last().unwrap();
    assert_eq!(final_a.buyer_a_access, std::vec![true]);
    assert_eq!(final_a.buyer_b_access, std::vec![false]);
    assert_eq!(final_b.buyer_a_access, std::vec![false]);
    assert_eq!(final_b.buyer_b_access, std::vec![true]);
    assert_eq!(final_a.solvency.tracked_liability, 100_000_000);
    assert_eq!(final_b.solvency.tracked_liability, 200_000_000);
}

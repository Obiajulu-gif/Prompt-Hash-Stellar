import {
  StellarWalletsKit,
  Networks,
} from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Horizon } from "@stellar/stellar-sdk";
import { horizonUrl, stellarNetwork, stellarWalletNetwork } from "../lib/env";

// The wallet kit was bumped from 1.x to 2.x which replaced the instance API
// with a static one. This module exposes the kit behind the same
// instance-style surface so the rest of the app is unaffected.
StellarWalletsKit.init({
  network: stellarWalletNetwork as Networks,
  modules: defaultModules(),
});

function getHorizonHost(mode: string) {
  switch (mode) {
    case "LOCAL":
    case "FUTURENET":
    case "TESTNET":
    case "PUBLIC":
      return horizonUrl;
    default:
      throw new Error(`Unknown Stellar network: ${mode}`);
  }
}

export const fetchBalance = async (address: string) => {
  const horizon = new Horizon.Server(getHorizonHost(stellarNetwork), {
    allowHttp: stellarNetwork === "LOCAL",
  });

  try {
    const { balances } = await horizon.accounts().accountId(address).call();
    return { ok: true, balances };
  } catch (e) {
    // Re-throw the error so callers can handle it appropriately
    console.error("Error fetching balance:", e);
    throw e;
  }
};

export type Balance = Awaited<ReturnType<typeof fetchBalance>>["balances"][number];

type SignOptions = {
  networkPassphrase?: string;
  address?: string;
  path?: string;
};

export const wallet = {
  setWallet: (id: string): void => {
    StellarWalletsKit.setWallet(id);
  },
  getAddress: (): Promise<{ address: string }> =>
    StellarWalletsKit.getAddress(),
  getNetwork: (): Promise<{ network: string; networkPassphrase: string }> =>
    StellarWalletsKit.getNetwork(),
  signTransaction: async (
    xdr: string,
    opts?: SignOptions,
  ): Promise<string> =>
    (await StellarWalletsKit.signTransaction(xdr, opts)).signedTxXdr,
  signMessage: async (
    message: string,
    opts?: SignOptions,
  ): Promise<string> =>
    (await StellarWalletsKit.signMessage(message, opts)).signedMessage,
  disconnect: (): Promise<void> => StellarWalletsKit.disconnect(),
  openModal: async (): Promise<void> => {
    await StellarWalletsKit.authModal();
  },
};

// Restore removed connectWallet export for backward compatibility
export const connectWallet = async (..._args: unknown[]): Promise<void> => {
  await StellarWalletsKit.authModal();
};

export {
  validatePayoutAddressFormat,
  verifyPayoutDestinationOnChain,
} from "../lib/stellar/payoutValidation";
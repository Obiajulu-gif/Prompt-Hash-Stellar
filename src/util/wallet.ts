import { 
  StellarWalletsKit, 
  WalletNetwork, 
  allowAllModules 
} from "@creit.tech/stellar-wallets-kit";
import { Horizon } from "@stellar/stellar-sdk";
import { horizonUrl, stellarNetwork, stellarWalletNetwork } from "../lib/env";

// allowAllModules() returns an array containing albedo, freighter, etc.
// This prevents us from having to import them individually and hitting the "Missing Export" error.
export const kit: StellarWalletsKit = new StellarWalletsKit({
  network: stellarWalletNetwork as WalletNetwork,
  modules: allowAllModules(),
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
    return balances;
  } catch (e) {
    // Re-throw the error so callers can handle it appropriately
    console.error("Error fetching balance:", e);
    throw e;
  }
};

export type Balance = Awaited<ReturnType<typeof fetchBalance>>[number];

export const wallet = kit;
import React from "react";
import { stellarNetwork } from "@/lib/env";

/**
 * Shows a prominent "TESTNET" badge when the app is running against the
 * Stellar test network (#334).  On Mainnet/Public this renders nothing so it
 * never clutters the production UI.
 *
 * Network selection is driven entirely by the PUBLIC_STELLAR_NETWORK
 * environment variable set at build time (see .env.example for all options).
 * The component is intentionally read-only — switching networks requires
 * redeployment with different env vars, which prevents accidental mainnet
 * interaction in a development build.
 */
const NetworkSwitcher: React.FC = () => {
  const isTestnet =
    stellarNetwork === "TESTNET" ||
    stellarNetwork === "FUTURENET" ||
    stellarNetwork === "LOCAL";

  if (!isTestnet) return null;

  const label =
    stellarNetwork === "LOCAL"
      ? "Local"
      : stellarNetwork.charAt(0) + stellarNetwork.slice(1).toLowerCase();

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-300"
      title={`App is connected to the Stellar ${label}. Real assets are NOT involved.`}
      aria-label={`Connected to Stellar ${label}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      {label}
    </div>
  );
};

export default NetworkSwitcher;

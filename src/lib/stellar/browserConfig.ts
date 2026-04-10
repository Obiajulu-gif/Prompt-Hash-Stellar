import {
  allowHttp,
  nativeAssetContractId,
  networkPassphrase,
  promptHashContractId,
  rpcUrl,
  simulationAccount,
} from "@/lib/env";
import type { PromptHashConfig } from "./promptHashClient";

export const browserStellarConfig: PromptHashConfig = {
  rpcUrl,
  networkPassphrase,
  allowHttp,
  promptHashContractId,
  nativeAssetContractId,
  simulationAccount,
};

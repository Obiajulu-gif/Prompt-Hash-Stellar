import { trim } from "../../util/trim";
import { xdr as stellarXDR } from "@stellar/stellar-sdk";

import { XdrType } from "../../types/types";
import type { ValidatorResult } from "../contract";

/**
 * Validate that the input is well-formed base64. Returns `false` when valid
 * (matching the shared `ValidatorResult` contract) or an error string.
 */
const validateBase64 = (value: string): ValidatorResult => {
  if (value.match(/^[-A-Za-z0-9+/=]*$/) === null) {
    return "The input is not valid base64 (a-zA-Z0-9+/=).";
  }

  return false;
};

/**
 * Validate that `value` is a parseable Stellar XDR of `type`
 * ("TransactionEnvelope" by default, or "LedgerKey").
 *
 * Conforms to the shared validator contract (`string | false`): `false` means
 * the XDR is valid, a `string` is the parse error. This matches every other
 * simple validator in `src/debug/validate/methods/` so it is handled
 * identically by consumers such as `handleValidate`.
 */
export const getXdrError = (value: string, type?: XdrType): ValidatorResult => {
  if (!value) {
    return false;
  }

  const defaultType = "Transaction Envelope";
  const selectedType = type || defaultType;

  const sanitizedXdr = trim(value);
  const base64Validation = validateBase64(sanitizedXdr);

  if (base64Validation !== false) {
    return base64Validation;
  }

  try {
    if (type === "LedgerKey") {
      stellarXDR.LedgerKey.fromXDR(sanitizedXdr, "base64");
    } else {
      stellarXDR.TransactionEnvelope.fromXDR(sanitizedXdr, "base64");
    }

    return false;
  } catch {
    return `Unable to parse input XDR into ${selectedType}`;
  }
};

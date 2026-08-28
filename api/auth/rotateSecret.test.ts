import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRotationStateForTests,
  rotateSecretCAS,
  rotateSecretWithApprovals,
} from "./rotateSecret";

describe("secret rotation approvals", () => {
  beforeEach(() => {
    __resetRotationStateForTests();
    process.env.SECRET_ROTATION_REQUIRED_APPROVALS = "2";
  });

  it("holds rotation until two distinct operators approve it", () => {
    const first = rotateSecretWithApprovals(0, "test-passphrase", "operator-a");
    expect(first).toMatchObject({
      ok: false,
      pending: true,
      requiredApprovals: 2,
      receivedApprovals: 1,
    });

    const second = rotateSecretWithApprovals(0, "test-passphrase", "operator-b");
    expect(second).toMatchObject({ ok: true, newVersion: 1 });
  });

  it("keeps compare-and-swap conflicts deterministic", () => {
    expect(rotateSecretCAS(0, "test-passphrase")).toMatchObject({ ok: true, newVersion: 1 });
    expect(rotateSecretCAS(0, "test-passphrase")).toMatchObject({
      ok: false,
      conflictVersion: 1,
    });
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PromptTrustMetadata } from "./PromptTrustMetadata";
import { normalizeContentHash, bytesToHex } from "../lib/crypto/promptCrypto";
import { decodePromptRecord } from "../lib/stellar/contractMethods";
import { Buffer } from "buffer";

describe("PromptTrustMetadata", () => {
  // Fixed 32-byte test vector representing an on-chain content_hash: BytesN<32>
  const testBytes32 = new Uint8Array([
    0x2c, 0x26, 0xb4, 0x6b, 0x68, 0xff, 0xc6, 0x8f,
    0xf9, 0x9b, 0x45, 0x3c, 0x1d, 0x30, 0x41, 0x34,
    0x13, 0x42, 0x2d, 0x70, 0x64, 0x83, 0xbf, 0xa0,
    0xf9, 0x8a, 0x5e, 0x88, 0x62, 0x66, 0xe7, 0xae,
  ]);

  const canonicalHex = bytesToHex(testBytes32); // 64-char lowercase hex

  it("renders a 32-byte Uint8Array hash that is byte-for-byte derivable back to original bytes", () => {
    render(
      <PromptTrustMetadata
        creatorAddress="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        salesCount={42}
        contentHash={testBytes32}
        purchased={false}
      />
    );

    const hashElement = screen.getByTestId("prompt-trust-hash");
    const renderedHash = hashElement.getAttribute("title");

    expect(renderedHash).toBe(canonicalHex);
    expect(renderedHash).toBe(normalizeContentHash(testBytes32));

    // Verify byte-for-byte derivability back to the same 32-byte value
    const derivedBytes = Uint8Array.from(Buffer.from(renderedHash!, "hex"));
    expect(derivedBytes.length).toBe(32);
    expect(derivedBytes).toEqual(testBytes32);
  });

  it("normalizes uppercase hex strings to canonical lowercase hex without byte mutation", () => {
    const uppercaseHex = canonicalHex.toUpperCase();

    render(
      <PromptTrustMetadata
        creatorAddress="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        salesCount={10}
        contentHash={uppercaseHex}
        purchased={true}
      />
    );

    const hashElement = screen.getByTestId("prompt-trust-hash");
    const renderedHash = hashElement.textContent;

    expect(renderedHash).toBe(canonicalHex);
    expect(renderedHash).not.toBe(uppercaseHex);
    expect(renderedHash).toBe(normalizeContentHash(uppercaseHex));

    // Assert derived bytes match test vector
    const derivedBytes = Uint8Array.from(Buffer.from(renderedHash!, "hex"));
    expect(derivedBytes).toEqual(testBytes32);
  });

  it("normalizes base64-encoded 32-byte hash to canonical lowercase hex", () => {
    const base64Hash = Buffer.from(testBytes32).toString("base64");

    render(
      <PromptTrustMetadata
        creatorAddress="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        salesCount={5}
        contentHash={base64Hash}
        purchased={false}
      />
    );

    const hashElement = screen.getByTestId("prompt-trust-hash");
    const renderedHash = hashElement.getAttribute("title");

    expect(renderedHash).toBe(canonicalHex);
    expect(renderedHash).toBe(normalizeContentHash(base64Hash));

    const derivedBytes = Uint8Array.from(Buffer.from(renderedHash!, "hex"));
    expect(derivedBytes).toEqual(testBytes32);
  });

  it("preserves exact content_hash when traced from contract decodePromptRecord to rendering", () => {
    // Simulate raw Soroban contract record returned by scValToNative
    const rawContractRecord = {
      creator: "GCREATORADDRESS1234567890",
      price: 10000000n,
      title: "Test Prompt",
      category: "Writing",
      preview_text: "Preview",
      description: "Desc",
      image_url: "https://example.com/img.png",
      sales_count: 7,
      active: true,
      content_hash: testBytes32, // Raw 32 bytes from Soroban BytesN<32>
    };

    const decodedRecord = decodePromptRecord(rawContractRecord, 1n);

    // Decoded record contentHash must match normalizeContentHash ground truth
    expect(decodedRecord.contentHash).toBe(canonicalHex);

    render(
      <PromptTrustMetadata
        creatorAddress={decodedRecord.creator}
        salesCount={decodedRecord.salesCount}
        contentHash={decodedRecord.contentHash}
        purchased={false}
      />
    );

    const hashElement = screen.getByTestId("prompt-trust-hash");
    const renderedHash = hashElement.getAttribute("title");

    expect(renderedHash).toBe(canonicalHex);
    expect(renderedHash).toBe(normalizeContentHash(testBytes32));

    // Confirm rendered hash can never diverge from unlock-time integrity check
    const derivedBytes = Uint8Array.from(Buffer.from(renderedHash!, "hex"));
    expect(derivedBytes).toEqual(testBytes32);
  });

  it("renders creator address, sales count, and appropriate button depending on purchase status", () => {
    const creator = "GABC1234567890";
    const { rerender } = render(
      <PromptTrustMetadata
        creatorAddress={creator}
        salesCount={100}
        contentHash={canonicalHex}
        purchased={false}
      />
    );

    expect(screen.getByText("Sales:")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Buy Prompt/i })).toBeInTheDocument();

    rerender(
      <PromptTrustMetadata
        creatorAddress={creator}
        salesCount={100}
        contentHash={canonicalHex}
        purchased={true}
      />
    );

    expect(screen.getByRole("button", { name: /Unlock Prompt/i })).toBeInTheDocument();
  });
});

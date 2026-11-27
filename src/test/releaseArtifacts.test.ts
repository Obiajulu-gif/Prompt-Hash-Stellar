import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { buildArtifactManifest, verifyArtifactManifest } from "../../scripts/release-artifacts.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("reproducible release artifact manifests (#1149)", () => {
  it("sorts paths and records stable byte hashes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prompt-hash-artifacts-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "z.wasm"), "z");
    await writeFile(path.join(root, "a.wasm"), "a");

    const manifest = await buildArtifactManifest(root);
    expect(manifest.files.map((file) => file.path)).toEqual(["a.wasm", "z.wasm"]);
    expect(manifest.files[0]).toMatchObject({ bytes: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await verifyArtifactManifest(root, manifest)).toBe(true);
  });

  it("detects tampering and allows a clean retry after the artifact is restored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prompt-hash-artifacts-"));
    temporaryRoots.push(root);
    const artifact = path.join(root, "contract.wasm");
    await writeFile(artifact, "original");
    const manifest = await buildArtifactManifest(root);

    await writeFile(artifact, "tampered");
    expect(await verifyArtifactManifest(root, manifest)).toBe(false);
    await writeFile(artifact, "original");
    expect(await verifyArtifactManifest(root, manifest)).toBe(true);
  });

  it("keeps a written manifest reproducible when read back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prompt-hash-artifacts-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "contract.wasm"), Buffer.from([0, 1, 2, 3]));
    const manifest = await buildArtifactManifest(root);
    const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
    const readBack = JSON.parse(manifestBytes);
    expect(Buffer.byteLength(await readFile(path.join(root, "contract.wasm")))).toBe(
      readBack.files[0].bytes,
    );
  });
});

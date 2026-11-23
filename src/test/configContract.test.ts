// @vitest-environment node
/**
 * Cross-environment configuration contract (docs/operations/config-contract.md).
 *
 * These tests read the real config files in the repo and fail when production-critical
 * settings go missing or drift apart: network name, passphrase, RPC/Horizon hosts,
 * contract IDs, unlock keys, secrets, and the env names the code actually reads.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NETWORK_PASSPHRASES,
  REQUIRED_ENV,
  checkEnvironment,
  classifyUrl,
  parseEnv,
} from "../../scripts/contributor-diagnostics.mjs";
import { getServerDeploymentManifest, validateUnlockSecrets } from "../lib/validation/envValidator";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ─── sources ─────────────────────────────────────────────────────────────────

/** Consecutive `# KEY=value` lines directly under a `# ── <header>` banner. */
function commentedBlock(text: string, header: RegExp): Record<string, string> {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => header.test(l));
  expect(start, `header ${header} not found`).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = l.match(/^#\s*([A-Z][A-Z0-9_]*=.*)$/);
    if (!m) break;
    out.push(m[1]);
  }
  return parseEnv(out.join("\n")) as Record<string, string>;
}

const exampleText = read(".env.example");
const example = parseEnv(exampleText) as Record<string, string>;
const mainnetTemplate = parseEnv(read("env.mainnet.example")) as Record<string, string>;
const serverExample = parseEnv(read("server/.env.example")) as Record<string, string>;
const keysIn = (text: string) => new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
/** Variables .env.example documents, active or commented-out. */
const exampleKeys = keysIn(exampleText);
/** Everything an operator can learn about from a template. */
const documentedKeys = new Set([...exampleKeys, ...keysIn(read("env.mainnet.example")), ...keysIn(read("server/.env.example"))]);

function enumValues(file: string): string[] {
  const m = read(file).match(/PUBLIC_STELLAR_NETWORK:\s*z\.enum\(\[([\s\S]*?)\]/);
  expect(m, `network enum not found in ${file}`).toBeTruthy();
  return [...m![1].matchAll(/"([A-Z]+)"/g)].map((x) => x[1]);
}

const profiles = [
  { name: ".env.example (testnet)", env: example, network: "TESTNET" },
  { name: ".env.example (mainnet block)", env: commentedBlock(exampleText, /^# ── Mainnet/), network: "PUBLIC" },
  { name: ".env.example (futurenet block)", env: commentedBlock(exampleText, /^# ── Futurenet/), network: "FUTURENET" },
  { name: "env.mainnet.example", env: mainnetTemplate, network: "PUBLIC" },
];

const nativeSac = (network: string) => Asset.native().contractId(NETWORK_PASSPHRASES[network as keyof typeof NETWORK_PASSPHRASES]);

// ─── 1. network settings agree everywhere ────────────────────────────────────

describe("network contract", () => {
  it("passphrase table matches the Stellar SDK", () => {
    expect(NETWORK_PASSPHRASES.PUBLIC).toBe(Networks.PUBLIC);
    expect(NETWORK_PASSPHRASES.TESTNET).toBe(Networks.TESTNET);
    expect(NETWORK_PASSPHRASES.FUTURENET).toBe(Networks.FUTURENET);
    expect(NETWORK_PASSPHRASES.LOCAL).toBe(Networks.STANDALONE);
  });

  it("both frontend schemas accept the same network names", () => {
    const a = enumValues("src/lib/env.ts").sort();
    expect(enumValues("src/contracts/util.ts").sort()).toEqual(a);
    expect(a).toEqual(["FUTURENET", "LOCAL", "PUBLIC", "STANDALONE", "TESTNET"]);
  });

  it("frontend never falls back to testnet defaults in production builds", () => {
    const src = read("src/lib/env.ts");
    const keys = [...src.matchAll(/^\s{2}(PUBLIC_[A-Z_]+):\s*z\b/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) {
      expect(src, k).toMatch(new RegExp(`import\\.meta\\.env\\.${k}\\s*\\?\\?\\s*\\(isProduction\\s*\\?\\s*undefined`));
    }
  });

  describe.each(profiles)("$name", ({ env, network }) => {
    it("uses a network name the frontend accepts", () => {
      expect(enumValues("src/lib/env.ts")).toContain(env.PUBLIC_STELLAR_NETWORK);
      expect(env.PUBLIC_STELLAR_NETWORK).toBe(network);
    });

    it("pairs the network with its own passphrase", () => {
      expect(env.PUBLIC_STELLAR_NETWORK_PASSPHRASE).toBe(NETWORK_PASSPHRASES[network as keyof typeof NETWORK_PASSPHRASES]);
    });

    it("points RPC and Horizon at the same network over https", () => {
      for (const k of ["PUBLIC_STELLAR_RPC_URL", "PUBLIC_STELLAR_HORIZON_URL"]) {
        expect(env[k], k).toMatch(/^https:\/\//);
        expect(classifyUrl(env[k]), k).toBe(network);
      }
    });
  });

  it("native XLM contract ID is the real SAC for the template's network", () => {
    expect(example.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID).toBe(nativeSac("TESTNET"));
    expect(mainnetTemplate.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID).toBe(nativeSac("PUBLIC"));
    expect(mainnetTemplate.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID).not.toBe(
      example.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID,
    );
  });
});

// ─── 2. templates stay in sync ───────────────────────────────────────────────

describe("template contract", () => {
  it("both templates define every required variable", () => {
    for (const k of REQUIRED_ENV) {
      expect(example, `.env.example missing ${k}`).toHaveProperty(k);
      expect(mainnetTemplate, `env.mainnet.example missing ${k}`).toHaveProperty(k);
    }
  });

  it("mainnet template defines no variable that .env.example does not document", () => {
    const stray = Object.keys(mainnetTemplate).filter((k) => !exampleKeys.has(k));
    expect(stray).toEqual([]);
  });

  it("scaffold environment differs between local and production templates", () => {
    expect(example.STELLAR_SCAFFOLD_ENV).toBe("development");
    expect(mainnetTemplate.STELLAR_SCAFFOLD_ENV).toBe("production");
  });

  it(".env.example only fails validation on values a developer must supply", () => {
    const fails = checkEnvironment(example, { example }).filter((c) => c.status === "fail");
    expect(fails.map((c) => c.id).sort()).toEqual([
      "env.placeholder:PUBLIC_PROMPT_HASH_CONTRACT_ID",
      "env.placeholder:PUBLIC_STELLAR_SIMULATION_ACCOUNT",
    ]);
  });

  it("mainnet template cannot be deployed unedited: every secret and ID is a placeholder", () => {
    const flagged = checkEnvironment(mainnetTemplate)
      .filter((c) => c.id.startsWith("env.placeholder:"))
      .map((c) => c.id.split(":")[1])
      .sort();
    expect(flagged).toEqual(
      [
        "CHALLENGE_TOKEN_SECRET",
        "PUBLIC_PROMPT_HASH_CONTRACT_ID",
        "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
        "PUBLIC_UNLOCK_PUBLIC_KEY",
        "UNLOCK_PRIVATE_KEY",
        "UNLOCK_PUBLIC_KEY",
      ].sort(),
    );
  });

  it("mainnet template becomes valid once placeholders are replaced", () => {
    const key = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
    const filled = {
      ...mainnetTemplate,
      PUBLIC_PROMPT_HASH_CONTRACT_ID: "C" + "B".repeat(55),
      PUBLIC_STELLAR_SIMULATION_ACCOUNT: "G" + "B".repeat(55),
      PUBLIC_UNLOCK_PUBLIC_KEY: key,
      UNLOCK_PUBLIC_KEY: key,
      UNLOCK_PRIVATE_KEY: "UkVBTFBSSVZBVEVLRVlWQUxVRQ==",
      CHALLENGE_TOKEN_SECRET: "a-real-random-production-secret",
    };
    expect(checkEnvironment(filled, { example }).filter((c) => c.status === "fail")).toEqual([]);
  });

  it("docker-compose testnet defaults equal the .env.example testnet profile", () => {
    const compose = read("docker-compose.yml");
    for (const k of ["PUBLIC_STELLAR_NETWORK", "PUBLIC_STELLAR_RPC_URL", "PUBLIC_STELLAR_HORIZON_URL"]) {
      const m = compose.match(new RegExp(`${k}:\\s*\\$\\{${k}:-([^}]+)\\}`));
      expect(m, `${k} default missing in docker-compose.yml`).toBeTruthy();
      expect(m![1], k).toBe(example[k]);
    }
  });

  it("server template documents MONGODB_URI", () => {
    expect(serverExample.MONGODB_URI).toMatch(/^mongodb(\+srv)?:\/\//);
  });
});

// ─── 3. environments.toml (contract tooling) ─────────────────────────────────

describe("environments.toml contract", () => {
  const toml = read("environments.toml");
  const section = (name: string) => {
    const m = toml.match(new RegExp(`\\[${name}\\.network\\]([\\s\\S]*?)(?=\\n\\[|$)`));
    expect(m, `[${name}.network] missing`).toBeTruthy();
    return m![1];
  };
  const field = (body: string, key: string) => body.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`))?.[1];

  it("development and staging use the testnet passphrase and the template RPC", () => {
    for (const env of ["development", "staging"]) {
      const body = section(env);
      expect(field(body, "network-passphrase"), env).toBe(NETWORK_PASSPHRASES.TESTNET);
      expect(field(body, "rpc-url"), env).toBe(example.PUBLIC_STELLAR_RPC_URL);
    }
  });

  it("production uses the public-network passphrase", () => {
    expect(field(section("production"), "network-passphrase")).toBe(NETWORK_PASSPHRASES.PUBLIC);
  });

  it("every --xlm constructor argument is the testnet SAC", () => {
    const ids = [...toml.matchAll(/--xlm\s+(C[A-Z0-9]{55})/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBe(nativeSac("TESTNET"));
  });
});

// ─── 4. CI workflows ─────────────────────────────────────────────────────────

describe("workflow contract", () => {
  it("workflow env blocks never mix a network with another network's RPC", () => {
    const dir = join(ROOT, ".github/workflows");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
      const text = readFileSync(join(dir, f), "utf8");
      const net = text.match(/PUBLIC_STELLAR_NETWORK:\s*"?([A-Z]+)"?/)?.[1];
      const rpc = text.match(/PUBLIC_STELLAR_RPC_URL:\s*"?(https?:\/\/[^"\s]+)"?/)?.[1];
      if (net && rpc) expect(classifyUrl(rpc), f).toBe(net);
      const id = text.match(/PUBLIC_PROMPT_HASH_CONTRACT_ID:\s*"?(C[A-Z0-9]*)"?/)?.[1];
      if (id) expect(id, f).toMatch(/^C[A-Z2-7]{55}$/);
    }
  });
});

// ─── 5. every env var the code reads is documented ───────────────────────────

function sourceFiles(dir: string): string[] {
  return (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.|(^|[\\/])(test|tests|__tests__)[\\/]|\.d\.ts$/.test(f))
    .map((f) => join(dir, f));
}

function envReads(files: string[], pattern: RegExp): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    for (const m of read(f).matchAll(pattern)) out.set(m[1], [...(out.get(m[1]) ?? []), f]);
  }
  return out;
}

describe("env var usage contract", () => {
  // Provided by the platform / build tool rather than by operators.
  const PLATFORM = new Set(["NODE_ENV", "VERCEL_ENV", "VERCEL_URL"]);
  // Pre-existing names with no template entry. Do not add to this list: document the variable instead.
  const KNOWN_LEGACY = new Set(["REACT_APP_API_URL"]);
  // Old spellings still read as fallbacks for the canonical PUBLIC_STELLAR_* names.
  const LEGACY_ALIASES: Record<string, string> = {
    PUBLIC_NATIVE_ASSET_CONTRACT_ID: "api/prompts/version.ts",
    PUBLIC_SIMULATION_ACCOUNT: "api/prompts/version.ts",
  };

  const serverReads = envReads([...sourceFiles("api"), ...sourceFiles("src/lib")], /process\.env\.([A-Z][A-Z0-9_]*)/g);
  const browserReads = envReads(sourceFiles("src"), /import\.meta\.env\.(PUBLIC_[A-Z0-9_]+)/g);

  it("every server-side env var is documented in a template", () => {
    const undocumented = [...serverReads.keys()].filter(
      (k) => !documentedKeys.has(k) && !PLATFORM.has(k) && !KNOWN_LEGACY.has(k) && !(k in LEGACY_ALIASES),
    );
    expect(undocumented).toEqual([]);
  });

  it("every browser-exposed PUBLIC_* var is documented in .env.example", () => {
    expect([...browserReads.keys()].filter((k) => !exampleKeys.has(k))).toEqual([]);
  });

  it("legacy aliases are only read next to their canonical name", () => {
    for (const [alias, file] of Object.entries(LEGACY_ALIASES)) {
      expect(serverReads.get(alias), alias).toEqual([file]);
      const canonical = alias.replace("PUBLIC_", "PUBLIC_STELLAR_");
      expect(read(file), alias).toContain(`process.env.${canonical}`);
    }
  });

  it("no browser code reads a secret", () => {
    const secrets = /SECRET|PRIVATE|TOKEN|WEBHOOK/;
    expect([...browserReads.keys()].filter((k) => secrets.test(k))).toEqual([]);
  });
});

// ─── 6. runtime validators reject broken production configs ──────────────────

describe("runtime validator contract (production)", () => {
  const original = { ...process.env };
  const key = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
  const good: Record<string, string> = {
    NODE_ENV: "production",
    PUBLIC_STELLAR_NETWORK: "PUBLIC",
    PUBLIC_STELLAR_NETWORK_PASSPHRASE: NETWORK_PASSPHRASES.PUBLIC,
    PUBLIC_STELLAR_RPC_URL: "https://mainnet.sorobanrpc.com",
    PUBLIC_STELLAR_HORIZON_URL: "https://horizon.stellar.org",
    PUBLIC_PROMPT_HASH_CONTRACT_ID: "C" + "B".repeat(55),
    PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID: nativeSac("PUBLIC"),
    PUBLIC_STELLAR_SIMULATION_ACCOUNT: "G" + "B".repeat(55),
    UNLOCK_PUBLIC_KEY: key,
    UNLOCK_PRIVATE_KEY: "UkVBTFBSSVZBVEVMRVlWQUxVRQ==",
    CHALLENGE_TOKEN_SECRET: "a-real-random-production-secret",
  };

  beforeEach(() => {
    process.env = { ...original, ...good };
  });
  afterEach(() => {
    process.env = original;
  });

  it("accepts a complete, consistent configuration", () => {
    expect(() => getServerDeploymentManifest(true)).not.toThrow();
    expect(() => validateUnlockSecrets()).not.toThrow();
  });

  it.each([
    "PUBLIC_STELLAR_NETWORK",
    "PUBLIC_STELLAR_RPC_URL",
    "PUBLIC_PROMPT_HASH_CONTRACT_ID",
    "PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID",
    "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
  ])("fails when %s is missing", (name) => {
    delete process.env[name];
    expect(() => getServerDeploymentManifest(true)).toThrow(name);
  });

  it.each(["CHALLENGE_TOKEN_SECRET", "UNLOCK_PUBLIC_KEY", "UNLOCK_PRIVATE_KEY"])("fails when %s is missing", (name) => {
    delete process.env[name];
    expect(() => validateUnlockSecrets()).toThrow(name);
  });

  it("fails on the MAINNET spelling the frontend rejects", () => {
    process.env.PUBLIC_STELLAR_NETWORK = "MAINNET";
    expect(() => getServerDeploymentManifest(true)).toThrow(/MAINNET is not accepted/);
  });

  it("fails when the passphrase belongs to another network", () => {
    process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE = NETWORK_PASSPHRASES.TESTNET;
    expect(() => getServerDeploymentManifest(true)).toThrow(/PASSPHRASE does not match/);
  });

  it("fails on placeholder IDs and secrets copied from env.mainnet.example", () => {
    process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID = mainnetTemplate.PUBLIC_PROMPT_HASH_CONTRACT_ID;
    expect(() => getServerDeploymentManifest(true)).toThrow(/placeholder/);
    process.env.CHALLENGE_TOKEN_SECRET = mainnetTemplate.CHALLENGE_TOKEN_SECRET;
    expect(() => validateUnlockSecrets()).toThrow(/placeholder/);
  });

  it("changes the manifest hash when any chain-critical setting changes", () => {
    const base = getServerDeploymentManifest(true).manifestHash;
    process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID = "C" + "D".repeat(55);
    expect(getServerDeploymentManifest(true).manifestHash).not.toBe(base);
  });
});

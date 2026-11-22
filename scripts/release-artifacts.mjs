import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function buildArtifactManifest(rootDir) {
  const root = path.resolve(rootDir);
  const files = [];

  async function visit(relativeDir) {
    const absoluteDir = path.join(root, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      const absolutePath = path.join(root, relativePath);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic links are not reproducible artifacts: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`unsupported artifact entry: ${relativePath}`);
      }

      const bytes = await fs.readFile(absolutePath);
      files.push({
        path: relativePath.split(path.sep).join("/"),
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }

  await visit("");
  return { version: 1, files };
}

export async function verifyArtifactManifest(rootDir, expected) {
  const actual = await buildArtifactManifest(rootDir);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function usage() {
  console.error("Usage: node scripts/release-artifacts.mjs --dir <artifact-dir> (--write <manifest> | --verify <manifest>)");
}

async function main(args) {
  const dirIndex = args.indexOf("--dir");
  const action = args.includes("--write") ? "--write" : args.includes("--verify") ? "--verify" : null;
  const actionIndex = action ? args.indexOf(action) : -1;
  if (dirIndex < 0 || actionIndex < 0 || !args[dirIndex + 1] || !args[actionIndex + 1]) {
    usage();
    process.exitCode = 2;
    return;
  }

  const rootDir = args[dirIndex + 1];
  const manifestPath = args[actionIndex + 1];
  if (action === "--write") {
    const manifest = await buildArtifactManifest(rootDir);
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Wrote ${manifest.files.length} artifact entries to ${manifestPath}`);
    return;
  }

  const expected = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!(await verifyArtifactManifest(rootDir, expected))) {
    throw new Error("artifact manifest mismatch: bytes or file ordering changed");
  }
  console.log(`Verified ${expected.files.length} artifact entries from ${manifestPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

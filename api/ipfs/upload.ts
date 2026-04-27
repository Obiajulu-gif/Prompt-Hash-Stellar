import { pinEncryptedPromptToIpfs } from "../../src/lib/ipfs";
import { withObservability } from "../../src/lib/observability/wrapper";

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const { encryptedPrompt } = req.body ?? {};

  if (!encryptedPrompt || typeof encryptedPrompt !== "string") {
    res.status(400).json({ error: "encryptedPrompt is required." });
    return;
  }

  try {
    const result = await pinEncryptedPromptToIpfs(encryptedPrompt);
    res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upload to IPFS.";

    req.logger?.error({ error: message }, "IPFS upload failed");
    res.status(500).json({ error: message });
  }
}

export default withObservability(handler, "ipfs/upload");
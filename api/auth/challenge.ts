import { createChallengeToken } from "../../src/lib/auth/challenge";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret) {
    res.status(500).json({ error: "CHALLENGE_TOKEN_SECRET is not configured." });
    return;
  }

  const { address, promptId } = req.body ?? {};
  if (!address || !promptId) {
    res.status(400).json({ error: "address and promptId are required." });
    return;
  }

  const challenge = createChallengeToken(secret, String(address), String(promptId));
  res.status(200).json(challenge);
}

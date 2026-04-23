import { z } from "zod";
import { createChallengeToken } from "../../src/lib/auth/challenge";

const ChallengeRequestSchema = z.object({
  address: z.string({ required_error: "address is required" }).min(1, "address is required"),
  promptId: z.string({ required_error: "promptId is required" }).min(1, "promptId is required"),
});

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret) {
    console.error("CHALLENGE_TOKEN_SECRET is not configured.");
    return res.status(500).json({ error: "Server configuration error." });
  }

  try {
    const { address, promptId } = ChallengeRequestSchema.parse(req.body);
    const challenge = createChallengeToken(secret, address, promptId);
    return res.status(200).json(challenge);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || error.message });
    }
    return res.status(500).json({ error: "Internal server error." });
  }
}

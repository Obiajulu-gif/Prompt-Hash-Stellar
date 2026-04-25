import express from "express";
import { ImproveProxy } from "./controllers/controllers";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { getSecret } from "../../src/lib/auth/secretManager";

const app = express();

const port = 5000;

app.use(express.json());

app.use("/api/improve-proxy", proxyrouter);

app.use("/api/prompts", promptRouter);

app.use("/api/user", userRouter);

app.use("/api/chat", chatRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

(async () => {
  const requiredSecrets = [
    "CHALLENGE_TOKEN_SECRET",
    "UNLOCK_PUBLIC_KEY",
    "UNLOCK_PRIVATE_KEY"
  ];

  for (const secretName of requiredSecrets) {
    const secret = await getSecret(secretName);
    if (!secret) {
      console.error(`Missing required secret: ${secretName}`);
      process.exit(1);
    }
  }

  console.log("All required secrets are loaded.");
})();

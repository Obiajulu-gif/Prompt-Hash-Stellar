import express from "express";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { config, validateConfig } from "./config";

validateConfig();

const app = express();

const port = config.port;

app.use(express.json());

app.use("/api/improve-prompt", proxyrouter);

app.use("/api/prompts", promptRouter);

app.use("/api/user", userRouter);

app.use("/api/chat", chatRouter);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    ai: {
      enabled: config.ai.enabled,
      provider: config.ai.enabled ? "configured" : "disabled",
    },
  });
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

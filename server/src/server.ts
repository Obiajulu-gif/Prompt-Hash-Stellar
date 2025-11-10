import express from "express";
import { ImproveProxy } from "./controllers/controllers";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";

const app = express();

const port = 5000;

app.use(express.json());

app.use("/api/improve-proxy", proxyrouter);

app.use("/api/prompts", promptRouter);

app.use("/api/user", userRouter);

app.use("/api/chat", chatRouter);

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

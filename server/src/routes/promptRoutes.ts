import express from "express";
import {
  CreatePrompt,
  GetPrompts,
  GetOwnedPrompts,
  GetSavedPrompts,
  SavePrompt,
  UnsavePrompt,
  GetDraftPrompts,
  PublishPrompt,
  ArchivePrompt,
} from "../controllers/controllers";

export const promptRouter = express.Router();

promptRouter.route("/").post(CreatePrompt);

promptRouter.route("/").get(GetPrompts);

promptRouter.get("/buyer/:walletAddress/owned", GetOwnedPrompts);
promptRouter.get("/buyer/:walletAddress/saved", GetSavedPrompts);
promptRouter.post("/buyer/save", SavePrompt);
promptRouter.post("/buyer/unsave", UnsavePrompt);
promptRouter.get("/creator/:walletAddress/drafts", GetDraftPrompts);
promptRouter.post("/:id/publish", PublishPrompt);
promptRouter.post("/:id/archive", ArchivePrompt);

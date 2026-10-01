import express from "express";
import { IndexPrompt, SearchMarketplace } from "../controllers/marketplaceControllers";

export const marketplaceRouter = express.Router();

// Full-text + filtered search across the indexed prompt metadata
marketplaceRouter.get("/search", SearchMarketplace);

// Manually index a prompt created through the platform UI
marketplaceRouter.post("/index", IndexPrompt);
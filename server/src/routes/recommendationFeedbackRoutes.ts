import express from "express";
import { recommendationFeedbackService } from "../services/recommendationFeedbackService.js";

export const recommendationFeedbackRouter = express.Router();

// Submit feedback
recommendationFeedbackRouter.post(
  "/",
  async (req, res) => {
    try {
      const { userWallet, promptId, creatorWallet, action, reason } = req.body;
      const feedback = await recommendationFeedbackService.submitFeedback({
        userWallet,
        promptId,
        creatorWallet,
        action,
        reason,
      });
      res.status(201).json(feedback);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get user's feedback history
recommendationFeedbackRouter.get(
  "/user/:userWallet",
  async (req, res) => {
    try {
      const feedback = await recommendationFeedbackService.getUserFeedback(
        req.params.userWallet
      );
      res.json(feedback);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get feedback for a prompt
recommendationFeedbackRouter.get(
  "/prompt/:promptId",
  async (req, res) => {
    try {
      const feedback = await recommendationFeedbackService.getPromptFeedback(
        req.params.promptId
      );
      res.json(feedback);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Hide a prompt for user
recommendationFeedbackRouter.post(
  "/:userWallet/hide-prompt",
  async (req, res) => {
    try {
      const { promptId } = req.body;
      const preferences = await recommendationFeedbackService.hidePrompt(
        req.params.userWallet,
        promptId
      );
      res.json(preferences);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Hide a creator for user
recommendationFeedbackRouter.post(
  "/:userWallet/hide-creator",
  async (req, res) => {
    try {
      const { creatorWallet } = req.body;
      const preferences = await recommendationFeedbackService.hideCreator(
        req.params.userWallet,
        creatorWallet
      );
      res.json(preferences);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Unhide a prompt for user
recommendationFeedbackRouter.post(
  "/:userWallet/unhide-prompt",
  async (req, res) => {
    try {
      const { promptId } = req.body;
      const preferences = await recommendationFeedbackService.unhidePrompt(
        req.params.userWallet,
        promptId
      );
      res.json(preferences);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Unhide a creator for user
recommendationFeedbackRouter.post(
  "/:userWallet/unhide-creator",
  async (req, res) => {
    try {
      const { creatorWallet } = req.body;
      const preferences = await recommendationFeedbackService.unhideCreator(
        req.params.userWallet,
        creatorWallet
      );
      res.json(preferences);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get user's hidden items
recommendationFeedbackRouter.get(
  "/:userWallet/preferences",
  async (req, res) => {
    try {
      const hidden = await recommendationFeedbackService.getHiddenItems(
        req.params.userWallet
      );
      res.json(hidden);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Reset user preferences
recommendationFeedbackRouter.post(
  "/:userWallet/reset-preferences",
  async (req, res) => {
    try {
      const preferences = await recommendationFeedbackService.resetPreferences(
        req.params.userWallet
      );
      res.json(preferences);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Filter recommendations based on hidden items
recommendationFeedbackRouter.post(
  "/:userWallet/filter-recommendations",
  async (req, res) => {
    try {
      const { promptIds } = req.body;
      const filtered = await recommendationFeedbackService.filterRecommendations(
        req.params.userWallet,
        promptIds
      );
      res.json({ filtered });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

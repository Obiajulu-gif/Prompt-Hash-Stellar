import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recommendationFeedbackService } from "../services/recommendationFeedbackService.js";
import RecommendationFeedback from "../models/RecommendationFeedback.js";
import UserPreferences from "../models/UserPreferences.js";

describe("RecommendationFeedbackService", () => {
  beforeEach(async () => {
    await RecommendationFeedback.deleteMany({});
    await UserPreferences.deleteMany({});
  });

  afterEach(async () => {
    await RecommendationFeedback.deleteMany({});
    await UserPreferences.deleteMany({});
  });

  it("should submit feedback", async () => {
    const feedback = await recommendationFeedbackService.submitFeedback({
      userWallet: "GUSER123",
      promptId: "prompt-456",
      action: "not_interested",
      reason: "Not relevant to my needs",
    });

    expect(feedback.userWallet).toBe("guser123");
    expect(feedback.promptId).toBe("prompt-456");
    expect(feedback.action).toBe("not_interested");
  });

  it("should hide a prompt and record preference", async () => {
    const promptId = "prompt-to-hide";
    const preferences = await recommendationFeedbackService.hidePrompt(
      "GUSER123",
      promptId
    );

    expect(preferences.hiddenPrompts).toContain(promptId);
  });

  it("should hide a creator", async () => {
    const creatorWallet = "GCREATOR123";
    const preferences = await recommendationFeedbackService.hideCreator(
      "GUSER123",
      creatorWallet
    );

    expect(preferences.hiddenCreators).toContain("gcreator123");
  });

  it("should unhide a prompt", async () => {
    const promptId = "prompt-to-hide";
    await recommendationFeedbackService.hidePrompt("GUSER123", promptId);

    const preferences = await recommendationFeedbackService.unhidePrompt(
      "GUSER123",
      promptId
    );

    expect(preferences.hiddenPrompts).not.toContain(promptId);
  });

  it("should get hidden items", async () => {
    const wallet = "GUSER123";
    await recommendationFeedbackService.hidePrompt(wallet, "prompt-1");
    await recommendationFeedbackService.hidePrompt(wallet, "prompt-2");
    await recommendationFeedbackService.hideCreator(wallet, "GCREATOR1");

    const hidden = await recommendationFeedbackService.getHiddenItems(wallet);

    expect(hidden.hiddenPrompts.length).toBe(2);
    expect(hidden.hiddenCreators.length).toBe(1);
  });

  it("should reset preferences", async () => {
    const wallet = "GUSER123";
    await recommendationFeedbackService.hidePrompt(wallet, "prompt-1");
    await recommendationFeedbackService.hideCreator(wallet, "GCREATOR1");

    const preferences = await recommendationFeedbackService.resetPreferences(wallet);

    expect(preferences.hiddenPrompts.length).toBe(0);
    expect(preferences.hiddenCreators.length).toBe(0);
    expect(preferences.preferenceResetAt).toBeDefined();
  });

  it("should filter recommendations", async () => {
    const wallet = "GUSER123";
    await recommendationFeedbackService.hidePrompt(wallet, "prompt-2");
    await recommendationFeedbackService.hidePrompt(wallet, "prompt-4");

    const promptIds = ["prompt-1", "prompt-2", "prompt-3", "prompt-4"];
    const filtered = await recommendationFeedbackService.filterRecommendations(
      wallet,
      promptIds
    );

    expect(filtered).toContain("prompt-1");
    expect(filtered).toContain("prompt-3");
    expect(filtered).not.toContain("prompt-2");
    expect(filtered).not.toContain("prompt-4");
  });

  it("should get user feedback history", async () => {
    const wallet = "GUSER123";
    await recommendationFeedbackService.submitFeedback({
      userWallet: wallet,
      promptId: "prompt-1",
      action: "not_interested",
    });

    await recommendationFeedbackService.submitFeedback({
      userWallet: wallet,
      promptId: "prompt-2",
      action: "improve_recommendations",
    });

    const feedback = await recommendationFeedbackService.getUserFeedback(wallet);
    expect(feedback.length).toBe(2);
  });

  it("should record hide_prompt feedback and update preferences", async () => {
    const promptId = "prompt-123";
    const wallet = "GUSER123";

    await recommendationFeedbackService.submitFeedback({
      userWallet: wallet,
      promptId,
      action: "hide_prompt",
    });

    const hidden = await recommendationFeedbackService.getHiddenItems(wallet);
    expect(hidden.hiddenPrompts).toContain(promptId);
  });

  it("should record hide_creator feedback and update preferences", async () => {
    const creatorWallet = "GCREATOR123";
    const userWallet = "GUSER123";

    await recommendationFeedbackService.submitFeedback({
      userWallet,
      creatorWallet,
      action: "hide_creator",
    });

    const hidden = await recommendationFeedbackService.getHiddenItems(userWallet);
    expect(hidden.hiddenCreators).toContain("gcreator123");
  });

  it("should get feedback for a prompt", async () => {
    const promptId = "prompt-456";
    await recommendationFeedbackService.submitFeedback({
      userWallet: "GUSER1",
      promptId,
      action: "not_interested",
    });

    await recommendationFeedbackService.submitFeedback({
      userWallet: "GUSER2",
      promptId,
      action: "improve_recommendations",
    });

    const feedback = await recommendationFeedbackService.getPromptFeedback(promptId);
    expect(feedback.length).toBe(2);
  });
});

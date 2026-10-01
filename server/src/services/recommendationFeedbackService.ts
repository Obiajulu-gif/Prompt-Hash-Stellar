import RecommendationFeedback, { FeedbackAction } from "../models/RecommendationFeedback.js";
import UserPreferences from "../models/UserPreferences.js";
import { logger } from "./auditTrail.js";

export interface SubmitFeedbackInput {
  userWallet: string;
  promptId?: string;
  creatorWallet?: string;
  action: FeedbackAction;
  reason?: string;
}

class RecommendationFeedbackService {
  async submitFeedback(input: SubmitFeedbackInput): Promise<any> {
    const feedback = new RecommendationFeedback({
      userWallet: input.userWallet.toLowerCase(),
      promptId: input.promptId,
      creatorWallet: input.creatorWallet?.toLowerCase(),
      action: input.action,
      reason: input.reason,
    });

    await feedback.save();

    // Update user preferences based on feedback
    await this.updatePreferencesFromFeedback(input);

    logger.info(`Feedback recorded: ${input.action} from user ${input.userWallet}`);
    return feedback;
  }

  async getUserFeedback(userWallet: string): Promise<any[]> {
    return RecommendationFeedback.find({
      userWallet: userWallet.toLowerCase(),
    }).sort({ createdAt: -1 });
  }

  async getPromptFeedback(promptId: string): Promise<any[]> {
    return RecommendationFeedback.find({ promptId }).sort({ createdAt: -1 });
  }

  async getCreatorFeedback(creatorWallet: string): Promise<any[]> {
    return RecommendationFeedback.find({
      creatorWallet: creatorWallet.toLowerCase(),
    }).sort({ createdAt: -1 });
  }

  async hidePrompt(userWallet: string, promptId: string): Promise<any> {
    const wallet = userWallet.toLowerCase();
    let preferences = await UserPreferences.findOne({ userWallet: wallet });

    if (!preferences) {
      preferences = new UserPreferences({
        userWallet: wallet,
        hiddenPrompts: [promptId],
      });
    } else if (!preferences.hiddenPrompts.includes(promptId)) {
      preferences.hiddenPrompts.push(promptId);
    }

    await preferences.save();
    return preferences;
  }

  async hideCreator(userWallet: string, creatorWallet: string): Promise<any> {
    const wallet = userWallet.toLowerCase();
    const creator = creatorWallet.toLowerCase();
    let preferences = await UserPreferences.findOne({ userWallet: wallet });

    if (!preferences) {
      preferences = new UserPreferences({
        userWallet: wallet,
        hiddenCreators: [creator],
      });
    } else if (!preferences.hiddenCreators.includes(creator)) {
      preferences.hiddenCreators.push(creator);
    }

    await preferences.save();
    return preferences;
  }

  async unhidePrompt(userWallet: string, promptId: string): Promise<any> {
    const wallet = userWallet.toLowerCase();
    const preferences = await UserPreferences.findOne({ userWallet: wallet });

    if (preferences) {
      preferences.hiddenPrompts = preferences.hiddenPrompts.filter((id) => id !== promptId);
      await preferences.save();
    }

    return preferences;
  }

  async unhideCreator(userWallet: string, creatorWallet: string): Promise<any> {
    const wallet = userWallet.toLowerCase();
    const creator = creatorWallet.toLowerCase();
    const preferences = await UserPreferences.findOne({ userWallet: wallet });

    if (preferences) {
      preferences.hiddenCreators = preferences.hiddenCreators.filter((c) => c !== creator);
      await preferences.save();
    }

    return preferences;
  }

  async getHiddenItems(userWallet: string): Promise<{ hiddenPrompts: string[]; hiddenCreators: string[] }> {
    const wallet = userWallet.toLowerCase();
    const preferences = await UserPreferences.findOne({ userWallet: wallet });

    return {
      hiddenPrompts: preferences?.hiddenPrompts || [],
      hiddenCreators: preferences?.hiddenCreators || [],
    };
  }

  async resetPreferences(userWallet: string): Promise<any> {
    const wallet = userWallet.toLowerCase();
    const preferences = await UserPreferences.findOne({ userWallet: wallet });

    if (preferences) {
      preferences.hiddenPrompts = [];
      preferences.hiddenCreators = [];
      preferences.preferenceResetAt = new Date();
      await preferences.save();
    }

    logger.info(`Preferences reset for user ${userWallet}`);
    return preferences;
  }

  async filterRecommendations(userWallet: string, promptIds: string[]): Promise<string[]> {
    const { hiddenPrompts, hiddenCreators } = await this.getHiddenItems(userWallet);
    // In production, would also check creatorWallet for each prompt
    return promptIds.filter((id) => !hiddenPrompts.includes(id));
  }

  private async updatePreferencesFromFeedback(input: SubmitFeedbackInput): Promise<void> {
    if (input.action === "hide_prompt" && input.promptId) {
      await this.hidePrompt(input.userWallet, input.promptId);
    } else if (input.action === "hide_creator" && input.creatorWallet) {
      await this.hideCreator(input.userWallet, input.creatorWallet);
    }
  }
}

export const recommendationFeedbackService = new RecommendationFeedbackService();

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-123" });
const mockCreateTransport = vi.fn().mockReturnValue({ sendMail: mockSendMail });

vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: any[]) => mockCreateTransport(...args) },
}));

const mockFindOne = vi.fn();
vi.mock("../models/User.js", () => ({
  default: { findOne: (...args: any[]) => mockFindOne(...args) },
}));

// Must import after mocks are set up
import {
  notifyPromptPurchased,
  notifyPromptUpdated,
} from "../services/emailNotifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeUser(overrides: Record<string, any> = {}) {
  return {
    walletAddress: "gbaddr1234567890abcdef",
    email: "creator@example.com",
    notificationPreferences: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("emailNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.EMAIL_FROM_ADDRESS = "Test <test@example.com>";
    process.env.APP_URL = "https://app.example.com";
  });

  // ── notifyPromptPurchased ────────────────────────────────────────────

  describe("notifyPromptPurchased", () => {
    it("sends email to creator when opted-in and email exists", async () => {
      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "My Prompt",
        promptId: "prompt-1",
        txHash: "tx-abc",
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
      const call = mockSendMail.mock.calls[0][0];
      expect(call.to).toBe("creator@example.com");
      expect(call.subject).toContain("My Prompt");
      expect(call.html).toContain("gbbuyer4");
      expect(call.html).toContain("tx-abc");
    });

    it("skips when creator has no email on file", async () => {
      mockFindOne.mockResolvedValue(fakeUser({ email: null }));

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "My Prompt",
        promptId: "prompt-1",
      });

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("skips when creator opted out", async () => {
      mockFindOne.mockResolvedValue(
        fakeUser({ notificationPreferences: { PromptPurchased: false } }),
      );

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "My Prompt",
        promptId: "prompt-1",
      });

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("sends when creator has no explicit preferences (default opt-in)", async () => {
      mockFindOne.mockResolvedValue(fakeUser({ notificationPreferences: {} }));

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "My Prompt",
        promptId: "prompt-1",
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
    });

    it("skips when SMTP is not configured", async () => {
      delete process.env.SMTP_HOST;
      delete process.env.EMAIL_SMTP_HOST;
      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "My Prompt",
        promptId: "prompt-1",
      });

      // sendMail should not be called because sendEmail returns early
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("does not throw on transport errors", async () => {
      mockFindOne.mockResolvedValue(fakeUser());
      mockSendMail.mockRejectedValueOnce(new Error("SMTP connection refused"));

      // Should not throw — errors are caught internally
      await expect(
        notifyPromptPurchased("gbcreator123", {
          buyerWallet: "gbbuyer456",
          promptTitle: "My Prompt",
          promptId: "prompt-1",
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── notifyPromptUpdated ─────────────────────────────────────────────

  describe("notifyPromptUpdated", () => {
    it("sends update email to all opted-in buyers", async () => {
      mockFindOne
        .mockResolvedValueOnce(fakeUser({ email: "buyer1@example.com" }))
        .mockResolvedValueOnce(fakeUser({ email: "buyer2@example.com" }));

      await notifyPromptUpdated(["gbbuyer1", "gbbuyer2"], {
        ownerWallet: "gbcreator",
        promptTitle: "Updated Prompt",
        promptId: "prompt-1",
        versionIndex: 2,
      });

      expect(mockSendMail).toHaveBeenCalledTimes(2);
      const subjects = mockSendMail.mock.calls.map((c: any) => c[0].subject);
      expect(subjects.every((s: string) => s.includes("Updated Prompt"))).toBe(true);
    });

    it("skips buyers with no email", async () => {
      mockFindOne
        .mockResolvedValueOnce(fakeUser({ email: "buyer1@example.com" }))
        .mockResolvedValueOnce(fakeUser({ email: null }));

      await notifyPromptUpdated(["gbbuyer1", "gbbuyer2"], {
        ownerWallet: "gbcreator",
        promptTitle: "Updated Prompt",
        promptId: "prompt-1",
        versionIndex: 2,
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
    });
  });

  // ── buildPurchaseEmail content ───────────────────────────────────────

  describe("email content", () => {
    it("includes prompt title and truncated buyer wallet", async () => {
      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer4567890abcdef1234567890abcdef",
        promptTitle: "Test Prompt",
        promptId: "prompt-1",
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain("Test Prompt");
      expect(html).toContain("gbbuyer4");
    });

    it("includes transaction hash when provided", async () => {
      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "Test",
        promptId: "prompt-1",
        txHash: "abc123def456",
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain("abc123def456");
    });

    it("omits transaction hash section when not provided", async () => {
      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "Test",
        promptId: "prompt-1",
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).not.toContain("Transaction");
    });
  });

  // ── createTransport configuration ────────────────────────────────────

  describe("transport configuration", () => {
    it("uses SMTP_* env vars with fallback to EMAIL_SMTP_*", async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.EMAIL_SMTP_HOST = "legacy.smtp.com";
      process.env.EMAIL_SMTP_PORT = "465";
      process.env.EMAIL_SMTP_USER = "legacy-user";
      process.env.EMAIL_SMTP_PASS = "legacy-pass";

      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "Test",
        promptId: "prompt-1",
      });

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "legacy.smtp.com",
          port: 465,
          secure: true,
        }),
      );
    });

    it("sets secure=true when port is 465", async () => {
      process.env.SMTP_PORT = "465";
      mockFindOne.mockResolvedValue(fakeUser());

      await notifyPromptPurchased("gbcreator123", {
        buyerWallet: "gbbuyer456",
        promptTitle: "Test",
        promptId: "prompt-1",
      });

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true }),
      );
    });
  });
});

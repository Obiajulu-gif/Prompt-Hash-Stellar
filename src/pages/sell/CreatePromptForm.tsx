import { ChangeEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { featuredPromptTemplates } from "@/data/featuredPrompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { unlockPublicKey } from "@/lib/env";
import {
  encryptPromptPlaintext,
  wrapPromptKey,
} from "@/lib/crypto/promptCrypto";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { xlmToStroops } from "@/lib/stellar/format";
import { createPrompt } from "@/lib/stellar/promptHashClient";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";

const limits = {
  title: 120,
  category: 40,
  preview: 280,
  encrypted: 4096,
  wrappedKey: 256,
  imageUrl: 512,
};

const categories = Array.from(
  new Set(featuredPromptTemplates.map((prompt) => prompt.category)),
);

interface FormData {
  imageUrl: string;
  title: string;
  category: string;
  previewText: string;
  fullPrompt: string;
  priceXlm: string;
}

export function CreatePromptForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { address, signTransaction } = useWallet();
  const [formData, setFormData] = useState<FormData>({
    imageUrl: "",
    title: "",
    category: "",
    previewText: "",
    fullPrompt: "",
    priceXlm: "2",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isConfigured = useMemo(
    () =>
      Boolean(
        address &&
          signTransaction &&
          browserStellarConfig.promptHashContractId &&
          unlockPublicKey,
      ),
    [address, signTransaction],
  );

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
  };

  const handleCategoryChange = (value: string) => {
    setFormData((previous) => ({ ...previous, category: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next.category;
      return next;
    });
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};

    if (!formData.imageUrl.trim()) {
      nextErrors.imageUrl = "Image URL is required.";
    } else if (formData.imageUrl.length > limits.imageUrl) {
      nextErrors.imageUrl = `Image URL must be ${limits.imageUrl} characters or fewer.`;
    }

    if (!formData.title.trim()) {
      nextErrors.title = "Title is required.";
    } else if (formData.title.length > limits.title) {
      nextErrors.title = `Title must be ${limits.title} characters or fewer.`;
    }

    if (!formData.category) {
      nextErrors.category = "Category is required.";
    } else if (formData.category.length > limits.category) {
      nextErrors.category = `Category must be ${limits.category} characters or fewer.`;
    }

    if (!formData.previewText.trim()) {
      nextErrors.previewText = "Preview text is required.";
    } else if (formData.previewText.length > limits.preview) {
      nextErrors.previewText = `Preview text must be ${limits.preview} characters or fewer.`;
    }

    if (!formData.fullPrompt.trim()) {
      nextErrors.fullPrompt = "Full prompt content is required.";
    }

    try {
      const price = xlmToStroops(formData.priceXlm);
      if (price <= 0n) {
        nextErrors.priceXlm = "Price must be greater than zero.";
      }
    } catch (error) {
      nextErrors.priceXlm =
        error instanceof Error ? error.message : "Enter a valid XLM price.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSuccessMessage(null);

    if (!validateForm()) {
      return;
    }

    if (!address || !signTransaction) {
      setSubmitError("Connect a Stellar wallet before creating a prompt.");
      return;
    }

    if (!browserStellarConfig.promptHashContractId) {
      setSubmitError("PUBLIC_PROMPT_HASH_CONTRACT_ID is not configured.");
      return;
    }

    if (!unlockPublicKey) {
      setSubmitError("PUBLIC_UNLOCK_PUBLIC_KEY is not configured.");
      return;
    }

    setIsSubmitting(true);
    try {
      const encrypted = await encryptPromptPlaintext(formData.fullPrompt);
      const wrappedKey = await wrapPromptKey(encrypted.keyBytes, unlockPublicKey);

      if (encrypted.encryptedPrompt.length > limits.encrypted) {
        throw new Error(
          "Encrypted payload is too large for the current on-chain limit. Shorten the full prompt and try again.",
        );
      }

      if (wrappedKey.length > limits.wrappedKey) {
        throw new Error("Wrapped key exceeds the contract storage limit.");
      }

      const { promptId } = await createPrompt(
        browserStellarConfig,
        { signTransaction },
        address,
        {
          imageUrl: formData.imageUrl.trim(),
          title: formData.title.trim(),
          category: formData.category,
          previewText: formData.previewText.trim(),
          encryptedPrompt: encrypted.encryptedPrompt,
          encryptionIv: encrypted.encryptionIv,
          wrappedKey,
          contentHash: encrypted.contentHash,
          priceStroops: xlmToStroops(formData.priceXlm),
        },
      );

      // Invalidate before navigating so the browse grid is fresh on arrival.
      await invalidateAllPromptQueries(queryClient);
      setSuccessMessage(`Prompt #${promptId.toString()} created successfully.`);
      setFormData({
        imageUrl: "",
        title: "",
        category: "",
        previewText: "",
        fullPrompt: "",
        priceXlm: "2",
      });
      navigate("/browse");
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to create prompt.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {!isConfigured ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Connect your wallet and configure `PUBLIC_PROMPT_HASH_CONTRACT_ID` plus
          `PUBLIC_UNLOCK_PUBLIC_KEY` before listing prompts.
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="create-prompt-image-url" className="text-sm font-medium">
            Image URL
          </label>
          <Input
            id="create-prompt-image-url"
            name="imageUrl"
            value={formData.imageUrl}
            onChange={handleChange}
            placeholder="https://example.com/prompt-cover.png"
            className={errors.imageUrl ? "border-red-500" : ""}
          />
          {errors.imageUrl ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.imageUrl}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="create-prompt-title" className="text-sm font-medium">
            Title
          </label>
          <Input
            id="create-prompt-title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="Board-ready launch plan"
            className={errors.title ? "border-red-500" : ""}
          />
          <p className="text-xs text-slate-400">
            {formData.title.length}/{limits.title}
          </p>
          {errors.title ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.title}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <label htmlFor="create-prompt-preview" className="text-sm font-medium">
            Preview text
          </label>
          <Textarea
            id="create-prompt-preview"
            name="previewText"
            value={formData.previewText}
            onChange={handleChange}
            placeholder="This public preview is visible on browse cards and modals."
            rows={4}
            className={errors.previewText ? "border-red-500" : ""}
          />
          <p className="text-xs text-slate-400">
            {formData.previewText.length}/{limits.preview}
          </p>
          {errors.previewText ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.previewText}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="create-prompt-category" className="text-sm font-medium">
            Category
          </label>
          <Select value={formData.category} onValueChange={handleCategoryChange}>
            <SelectTrigger
              id="create-prompt-category"
              aria-label="Category"
              className={errors.category ? "border-red-500" : ""}
            >
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.category}
            </p>
          ) : null}

          <label htmlFor="create-prompt-price" className="pt-3 text-sm font-medium">
            Price in XLM
          </label>
          <Input
            id="create-prompt-price"
            name="priceXlm"
            value={formData.priceXlm}
            onChange={handleChange}
            placeholder="2.5"
            className={errors.priceXlm ? "border-red-500" : ""}
          />
          {errors.priceXlm ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.priceXlm}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="create-prompt-full-prompt" className="text-sm font-medium">
          Full prompt
        </label>
        <Textarea
          id="create-prompt-full-prompt"
          name="fullPrompt"
          value={formData.fullPrompt}
          onChange={handleChange}
          rows={12}
          placeholder="This plaintext is encrypted in the browser, then only encrypted fields are sent on-chain."
          className={errors.fullPrompt ? "border-red-500" : ""}
        />
        {errors.fullPrompt ? (
          <p className="flex items-center gap-1 text-sm text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {errors.fullPrompt}
          </p>
        ) : null}
      </div>

      <Button
        className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
        disabled={isSubmitting}
        onClick={handleSubmit}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Encrypting and submitting...
          </>
        ) : (
          "Create prompt listing"
        )}
      </Button>

      {submitError ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {submitError}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {successMessage}
        </div>
      ) : null}
    </div>
  );
}

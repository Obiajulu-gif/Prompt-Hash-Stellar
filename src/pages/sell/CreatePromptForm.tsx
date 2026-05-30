import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  ListingQualityChecklist,
  buildChecklistItems,
} from "@/components/sell/ListingQualityChecklist";
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
import {
  LISTING_LIMITS,
  validateListingForm,
} from "@/lib/validation/listing";

const limits = {
  ...LISTING_LIMITS,
  encrypted: 4096,
  wrappedKey: 256,
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

interface CreatePromptFormProps {
  onCreated?: () => void;
}

const DRAFT_STORAGE_PREFIX = "prompt-hash:create-draft:";

const createEmptyFormData = (): FormData => ({
  imageUrl: "",
  title: "",
  category: "",
  previewText: "",
  fullPrompt: "",
  priceXlm: "2",
});

export function CreatePromptForm({ onCreated }: CreatePromptFormProps) {
  const navigate = useNavigate();
  const { address, signTransaction } = useWallet();
  const draftStorageKey = address ? `${DRAFT_STORAGE_PREFIX}${address}` : null;
  const draftLoadRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(false);
  const [formData, setFormData] = useState<FormData>(createEmptyFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

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

  const checklistItems = useMemo(
    () => buildChecklistItems(formData),
    [formData],
  );

  const checklistHasFailures = checklistItems.some((i) => i.status === "fail");

  const clearDraft = () => {
    if (draftStorageKey) {
      window.localStorage.removeItem(draftStorageKey);
    }
    skipNextAutosaveRef.current = true;
    setDraftRestored(false);
    setLastSavedAt(null);
  };

  useEffect(() => {
    draftLoadRef.current = null;
    setDraftRestored(false);
    setLastSavedAt(null);

    if (!draftStorageKey) {
      setFormData(createEmptyFormData());
      return;
    }

    const rawDraft = window.localStorage.getItem(draftStorageKey);
    if (!rawDraft) {
      skipNextAutosaveRef.current = true;
      setFormData(createEmptyFormData());
      draftLoadRef.current = draftStorageKey;
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as {
        formData?: Partial<FormData>;
        savedAt?: string;
      };

      if (parsed.formData) {
        setFormData((current) => ({
          ...current,
          ...parsed.formData,
        }));
        setDraftRestored(true);
        setLastSavedAt(parsed.savedAt ?? null);
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    } finally {
      draftLoadRef.current = draftStorageKey;
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || draftLoadRef.current !== draftStorageKey || isSubmitting) {
      return;
    }

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          savedAt,
          formData,
        }),
      );
      setLastSavedAt(savedAt);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [draftStorageKey, formData, isSubmitting]);

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
    const nextErrors = validateListingForm(formData);
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSuccessMessage(null);

    // Show checklist on first click so the creator can review quality
    if (!showChecklist) {
      setShowChecklist(true);
    }

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

      setSuccessMessage(`Prompt #${promptId.toString()} created successfully.`);
      clearDraft();
      setFormData(createEmptyFormData());
      if (onCreated) {
        onCreated();
      } else {
        navigate("/browse");
      }
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
          <label htmlFor="imageUrl" className="text-sm font-medium">
            Image URL
          </label>
          <Input
            id="imageUrl"
            name="imageUrl"
            value={formData.imageUrl}
            onChange={handleChange}
            type="url"
            autoComplete="url"
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
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <Input
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            autoComplete="off"
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
          <label htmlFor="previewText" className="text-sm font-medium">
            Preview text
          </label>
          <Textarea
            id="previewText"
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
          <label htmlFor="category" className="text-sm font-medium">
            Category
          </label>
          <Select value={formData.category} onValueChange={handleCategoryChange}>
            <SelectTrigger
              id="category"
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

          <label htmlFor="priceXlm" className="pt-3 text-sm font-medium">
            Price in XLM
          </label>
          <Input
            id="priceXlm"
            name="priceXlm"
            value={formData.priceXlm}
            onChange={handleChange}
            inputMode="decimal"
            autoComplete="off"
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
        <label htmlFor="fullPrompt" className="text-sm font-medium">
          Full prompt
        </label>
        <Textarea
          id="fullPrompt"
          name="fullPrompt"
          value={formData.fullPrompt}
          onChange={handleChange}
          autoComplete="off"
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

      {showChecklist ? (
        <ListingQualityChecklist items={checklistItems} />
      ) : null}

      {(draftRestored || lastSavedAt) && !isSubmitting ? (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {draftRestored ? "Recovered local draft." : "Draft saved locally."}
              </p>
              <p className="text-xs text-cyan-100/80">
                Stored only on this device and cleared after publish or discard.
                {lastSavedAt ? ` Last saved ${new Date(lastSavedAt).toLocaleString()}.` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-cyan-300/30 bg-cyan-500/10 text-cyan-50 hover:bg-cyan-500/20"
              onClick={() => {
                clearDraft();
                setFormData(createEmptyFormData());
                setErrors({});
                setShowChecklist(false);
              }}
            >
              Discard draft
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
        disabled={isSubmitting || (showChecklist && checklistHasFailures)}
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

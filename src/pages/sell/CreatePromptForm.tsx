import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ListingQualityChecklist,
  buildChecklistItems,
} from "@/components/sell/ListingQualityChecklist";
import { CreatorOnboarding } from "@/components/sell/CreatorOnboarding";
import { PricingGuidance } from "@/components/sell/PricingGuidance";
import { TagInput } from "@/components/sell/TagInput";
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
import { isIpfsUploadConfigured, uploadCiphertextToIpfs } from "@/lib/ipfs";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { xlmToStroops } from "@/lib/stellar/format";
import { createPrompt } from "@/lib/stellar/promptHashClient";
import {
  LISTING_LIMITS,
  RevenueSplitFormInput,
  validateListingForm,
  validateEncryptedPayload,
} from "@/lib/validation/listing";
import { MarkdownContent } from "@/components/MarkdownContent";

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
  description: string;
  fullPrompt: string;
  priceXlm: string;
  tags: string[];
  coCreators: RevenueSplitFormInput[];
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
  description: "",
  fullPrompt: "",
  priceXlm: "2",
  tags: [],
  coCreators: [],
});

const createEmptyCoCreator = (): RevenueSplitFormInput => ({
  address: "",
  sharePercent: "",
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
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [isFirstListing] = useState(true);
  const [descriptionTab, setDescriptionTab] = useState<"write" | "preview">(
    "write",
  );

  // ... (all hooks and handlers unchanged) ...
  const isConfigured = useMemo(
    () =>
      Boolean(
        address && browserStellarConfig.promptHashContractId && unlockPublicKey,
      ),
    [address, signTransaction],
  );

  // When IPFS is configured, large encrypted payloads are stored off-chain so
  // the on-chain size cap no longer limits how long a prompt can be.
  const offChainStorage = useMemo(() => isIpfsUploadConfigured(), []);

  const checklistItems = useMemo(
    () => buildChecklistItems(formData, { offChainStorage }),
    [formData, offChainStorage],
  );

  const checklistHasFailures = checklistItems.some((i) => i.status === "fail");
  const totalRevenueSharePercent = useMemo(
    () =>
      formData.coCreators.reduce(
        (sum, coCreator) => sum + (Number(coCreator.sharePercent.trim()) || 0),
        0,
      ),
    [formData.coCreators],
  );

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
          coCreators: parsed.formData?.coCreators ?? current.coCreators,
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
    if (
      !draftStorageKey ||
      draftLoadRef.current !== draftStorageKey ||
      isSubmitting
    ) {
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

  const handleCoCreatorChange = (
    index: number,
    field: keyof RevenueSplitFormInput,
    value: string,
  ) => {
    setFormData((previous) => ({
      ...previous,
      coCreators: previous.coCreators.map((coCreator, currentIndex) =>
        currentIndex === index ? { ...coCreator, [field]: value } : coCreator,
      ),
    }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next.coCreators;
      return next;
    });
  };

  const addCoCreator = () => {
    setFormData((previous) => {
      if (previous.coCreators.length >= LISTING_LIMITS.maxCoCreators) {
        return previous;
      }

      return {
        ...previous,
        coCreators: [...previous.coCreators, createEmptyCoCreator()],
      };
    });
    setErrors((previous) => {
      const next = { ...previous };
      delete next.coCreators;
      return next;
    });
  };

  const removeCoCreator = (index: number) => {
    setFormData((previous) => ({
      ...previous,
      coCreators: previous.coCreators.filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next.coCreators;
      return next;
    });
  };

  const validateForm = () => {
    const nextErrors = validateListingForm(formData, { offChainStorage });
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
      const wrappedKey = await wrapPromptKey(
        encrypted.keyBytes,
        unlockPublicKey,
      );

      // Store the (potentially large) ciphertext off-chain on IPFS when
      // configured, keeping only a compact `ipfs://<cid>` reference on-chain.
      // Falls back to inline on-chain storage when IPFS is not configured.
      let encryptedPromptPayload = encrypted.encryptedPrompt;
      if (offChainStorage) {
        const { uri } = await uploadCiphertextToIpfs(
          encrypted.encryptedPrompt,
          {
            name: `prompt-${address.slice(0, 8)}`,
          },
        );
        encryptedPromptPayload = uri;
      }

      const payloadErrors = validateEncryptedPayload({
        encryptedPrompt: encryptedPromptPayload,
        wrappedKey,
        encryptionIv: encrypted.encryptionIv,
      });
      const firstPayloadError = Object.values(payloadErrors)[0];
      if (firstPayloadError) {
        throw new Error(firstPayloadError);
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
          encryptedPrompt: encryptedPromptPayload,
          encryptionIv: encrypted.encryptionIv,
          wrappedKey,
          contentHash: encrypted.contentHash,
          priceStroops: xlmToStroops(formData.priceXlm),
          splits: formData.coCreators.map((coCreator) => ({
            recipient: coCreator.address.trim(),
            bps: Math.round(Number(coCreator.sharePercent.trim()) * 100),
          })),
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
    <>
      <div className="space-y-6">
        {showOnboarding && (
          <CreatorOnboarding
          isFirstListing={isFirstListing}
          {...({ onDismiss: () => setShowOnboarding(false) } as any)}
        />
        )}

        {!isConfigured ? (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Connect your wallet and configure `PUBLIC_PROMPT_HASH_CONTRACT_ID`
            plus `PUBLIC_UNLOCK_PUBLIC_KEY` before listing prompts.
          </div>
        ) : null}

        {(draftRestored || lastSavedAt) && isConfigured && (
          <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2.5 text-xs text-cyan-100">
            {draftRestored ? (
              <>
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                Draft restored from{" "}
                {lastSavedAt
                  ? new Date(lastSavedAt).toLocaleString()
                  : "previous session"}
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Draft saved{" "}
                {lastSavedAt ? new Date(lastSavedAt).toLocaleString() : ""}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                clearDraft();
                setFormData(createEmptyFormData());
                setErrors({});
                setShowChecklist(false);
              }}
              className="ml-auto text-xs text-cyan-200 underline underline-offset-2 hover:text-cyan-50"
            >
              Discard
            </button>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="imageUrl" className="text-sm font-medium text-slate-100">
              Image URL <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Input
              id="imageUrl"
              name="imageUrl"
              required
              aria-required="true"
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
            <label htmlFor="title" className="text-sm font-medium text-slate-100">
              Title <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Input
              id="title"
              name="title"
              required
              aria-required="true"
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
            <label htmlFor="previewText" className="text-sm font-medium text-slate-100">
              Preview text <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Textarea
              id="previewText"
              name="previewText"
              required
              aria-required="true"
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
            <label htmlFor="category" className="text-sm font-medium text-slate-100">
              Category <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Select
              value={formData.category}
              onValueChange={handleCategoryChange}
            >
              <SelectTrigger
                id="category"
                aria-required="true"
                aria-label="Prompt category"
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

            <label htmlFor="priceXlm" className="pt-3 text-sm font-medium text-slate-100">
              Price in XLM <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Input
              id="priceXlm"
              name="priceXlm"
              required
              aria-required="true"
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

        {/* Description with Markdown editor + preview (#330) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="description" className="text-sm font-medium text-slate-100">
              Description{" "}
              <span className="text-slate-500 font-normal">
                (Markdown supported)
              </span>
            </label>
            <div className="flex gap-1 rounded-lg border border-white/10 p-0.5 bg-slate-900/60">
              <button
                type="button"
                onClick={() => setDescriptionTab("write")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  descriptionTab === "write"
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Pencil className="h-3 w-3" /> Write
              </button>
              <button
                type="button"
                onClick={() => setDescriptionTab("preview")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  descriptionTab === "preview"
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Eye className="h-3 w-3" /> Preview
              </button>
            </div>
          </div>
          {descriptionTab === "write" ? (
            <Textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe your prompt in detail. **Bold**, *italics*, `code`, and lists all work."
              rows={6}
            />
          ) : (
            <div className="min-h-[144px] rounded-md border border-white/10 bg-slate-900/40 p-3">
              {formData.description ? (
                <MarkdownContent>{formData.description}</MarkdownContent>
              ) : (
                <p className="text-sm text-slate-500 italic">
                  Nothing to preview yet — write some Markdown first.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">
            {formData.description.length} / 4000 characters
          </p>
        </div>

        <PricingGuidance currentPriceXlm={formData.priceXlm} />

        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-100">
                Co-creators and revenue splits
              </h3>
              <p className="text-xs text-slate-400">
                Share a portion of each sale with collaborators already
                supported by the contract.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={addCoCreator}
              disabled={
                formData.coCreators.length >= LISTING_LIMITS.maxCoCreators
              }
            >
              <Plus className="h-4 w-4" />
              Add co-creator
            </Button>
          </div>

          {formData.coCreators.length > 0 ? (
            <div className="space-y-3">
              {formData.coCreators.map((coCreator, index) => (
                <div
                  key={`${index}-${coCreator.address}`}
                  className="grid gap-3 rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">
                      Stellar address
                    </label>
                    <Input
                      value={coCreator.address}
                      onChange={(event) =>
                        handleCoCreatorChange(
                          index,
                          "address",
                          event.target.value,
                        )
                      }
                      autoComplete="off"
                      placeholder="G..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">
                      Share %
                    </label>
                    <Input
                      value={coCreator.sharePercent}
                      onChange={(event) =>
                        handleCoCreatorChange(
                          index,
                          "sharePercent",
                          event.target.value,
                        )
                      }
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="15"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3 text-slate-300 hover:text-white"
                      onClick={() => removeCoCreator(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Add collaborators here when a prompt has multiple creators.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Total shared: {totalRevenueSharePercent.toFixed(2)}%</span>
            <span>
              Primary creator keeps:{" "}
              {Math.max(0, 100 - totalRevenueSharePercent).toFixed(2)}%
            </span>
          </div>

          {errors.coCreators ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.coCreators}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="fullPrompt" className="text-sm font-medium text-slate-100">
            Full prompt <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <Textarea
            id="fullPrompt"
            name="fullPrompt"
            required
            aria-required="true"
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

      {/* Image URL */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">Image URL</label>
        <Input
          value={formData.imageUrl}
          onChange={updateField("imageUrl")}
          placeholder="https://example.com/cover.png"
          maxLength={limits.imageUrl}
        />
        {errors.imageUrl && (
          <p className="text-xs text-red-400">{errors.imageUrl}</p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">Title</label>
        <Input
          value={formData.title}
          onChange={updateField("title")}
          placeholder="e.g. Advanced React Component Generator"
          maxLength={limits.title}
        />
        {errors.title && (
          <p className="text-xs text-red-400">{errors.title}</p>
        )}
      </div>

      {/* Category */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">Category</label>
        <Select
          value={formData.category}
          onValueChange={(value) =>
            setFormData((prev) => ({ ...prev, category: value }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.category && (
          <p className="text-xs text-red-400">{errors.category}</p>
        )}
      </div>

      {/* Preview Text */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">Preview Text</label>
        <Textarea
          value={formData.previewText}
          onChange={updateField("previewText")}
          placeholder="A short public description shown on browse cards…"
          maxLength={limits.preview}
          rows={3}
        />
        {errors.previewText && (
          <p className="text-xs text-red-400">{errors.previewText}</p>
        )}
      </div>

      {/* Full Description */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-100">Full Description</label>
          <button
            type="button"
            onClick={() =>
              setDescriptionTab((t) => (t === "write" ? "preview" : "write"))
            }
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            {descriptionTab === "write" ? (
              <>
                <Eye className="h-3 w-3" /> Preview
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" /> Edit
              </>
            )}
          </button>
        </div>
        {descriptionTab === "write" ? (
          <Textarea
            value={formData.description}
            onChange={updateField("description")}
            placeholder="Detailed description of what this prompt does…"
            rows={5}
          />
        ) : (
          <div className="min-h-[100px] rounded-lg border border-white/10 bg-white/5 p-3">
            <MarkdownContent content={formData.description || "*No description provided.*"} />
          </div>
        )}
      </div>

      {/* Full Prompt */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">
          Full Prompt{" "}
          <span className="text-xs text-slate-400">
            (encrypted before submission)
          </span>
        </label>
        <Textarea
          value={formData.fullPrompt}
          onChange={updateField("fullPrompt")}
          placeholder="Paste the full prompt content here…"
          maxLength={limits.fullPrompt}
          rows={8}
        />
        {errors.fullPrompt && (
          <p className="text-xs text-red-400">{errors.fullPrompt}</p>
        )}
      </div>

      {/* Price */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">Price (XLM)</label>
        <Input
          value={formData.priceXlm}
          onChange={updateField("priceXlm")}
          placeholder="0.00"
          type="number"
          step="0.0000001"
          min="0"
        />
        {errors.priceXlm && (
          <p className="text-xs text-red-400">{errors.priceXlm}</p>
        )}
      </div>

      {/* Pricing Guidance */}
      <PricingGuidance priceXlm={formData.priceXlm} />

      {/* Co-creators */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-100">Co-creators (optional)</label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFormData((prev) => ({
                ...prev,
                coCreators: [...prev.coCreators, createEmptyCoCreator()],
              }))
            }
            className="text-xs"
          >
            <Plus className="mr-1 h-3 w-3" /> Add co-creator
          </Button>
        </div>
        {formData.coCreators.map((coCreator, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <Input
                placeholder="Stellar address"
                value={coCreator.address}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    coCreators: prev.coCreators.map((c, i) =>
                      i === index ? { ...c, address: e.target.value } : c,
                    ),
                  }))
                }
              />
            </div>
            <div className="w-24 space-y-1">
              <Input
                placeholder="%"
                type="number"
                min="0"
                max="100"
                value={coCreator.sharePercent}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    coCreators: prev.coCreators.map((c, i) =>
                      i === index ? { ...c, sharePercent: e.target.value } : c,
                    ),
                  }))
                }
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  coCreators: prev.coCreators.filter((_, i) => i !== index),
                }))
              }
              className="mt-0.5 h-9 w-9 shrink-0"
            >
              <Trash2 className="h-4 w-4 text-red-400" />
            </Button>
          </div>
        ))}
        {errors.coCreators && (
          <p className="text-xs text-red-400">{errors.coCreators}</p>
        )}
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">Tags</label>
        <TagInput
          value={formData.tags}
          onChange={(tags) =>
            setFormData((prev) => ({ ...prev, tags }))
          }
        />
      </div>
    </>
  );
}

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [isFirstListing, setIsFirstListing] = useState(true);
  const [descriptionTab, setDescriptionTab] = useState<"write" | "preview">("write");

  // ... (all hooks and handlers unchanged) ...

  return (
    <>
      <div className="space-y-6">
      {showOnboarding && (
        <CreatorOnboarding
          isFirstListing={isFirstListing}
          onDismiss={() => setShowOnboarding(false)}
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
          <Select
            value={formData.category}
            onValueChange={handleCategoryChange}
          >
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

      {/* Description with Markdown editor + preview (#330) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="description" className="text-sm font-medium">
            Description <span className="text-slate-500 font-normal">(Markdown supported)</span>
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
              <p className="text-sm text-slate-500 italic">Nothing to preview yet — write some Markdown first.</p>
            )}
          </div>
        )}
        <p className="text-xs text-slate-400">{formData.description.length} / 4000 characters</p>
      </div>

      <PricingGuidance currentPriceXlm={formData.priceXlm} />

      <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-slate-100">
              Co-creators and revenue splits
            </h3>
            <p className="text-xs text-slate-400">
              Share a portion of each sale with collaborators already supported by the contract.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={addCoCreator}
            disabled={formData.coCreators.length >= LISTING_LIMITS.maxCoCreators}
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
                      handleCoCreatorChange(index, "address", event.target.value)
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
                      handleCoCreatorChange(index, "sharePercent", event.target.value)
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
          <span>Primary creator keeps: {Math.max(0, 100 - totalRevenueSharePercent).toFixed(2)}%</span>
        </div>

        {errors.coCreators ? (
          <p className="flex items-center gap-1 text-sm text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {errors.coCreators}
          </p>
        ) : null}
      </div>

      {/* #259 — Tag suggestions */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Tags</label>
        <TagInput
          value={formData.tags}
          onChange={(tags) =>
            setFormData((prev) => ({ ...prev, tags }))
          }
        />
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
    </>
  );
}

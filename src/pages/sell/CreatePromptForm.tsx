import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
  createPromptSchema,
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

export function CreatePromptForm({ onCreated }: CreatePromptFormProps) {
  const navigate = useNavigate();
  const { address, signTransaction } = useWallet();
  const draftStorageKey = address ? `${DRAFT_STORAGE_PREFIX}${address}` : null;
  const draftLoadRef = useRef<string | null>(null);
  
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(true);
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [isFirstListing] = useState(true);
  const [descriptionTab, setDescriptionTab] = useState<"write" | "preview">("write");

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<any>({
    resolver: zodResolver(createPromptSchema),
    defaultValues: {
      imageUrl: "",
      title: "",
      category: "",
      previewText: "",
      description: "",
      fullPrompt: "",
      priceXlm: "2",
      coCreators: [],
    },
    mode: "onChange",
  });

  const watchAllFields = watch();

  const isConfigured = useMemo(
    () => Boolean(address && browserStellarConfig.promptHashContractId && unlockPublicKey),
    [address]
  );

  const offChainStorage = useMemo(() => isIpfsUploadConfigured(), []);

  const checklistItems = useMemo(
    () =>
      buildChecklistItems(
        {
          title: watchAllFields.title || "",
          description: watchAllFields.description || "",
          fullPrompt: watchAllFields.fullPrompt || "",
          priceXlm: String(watchAllFields.priceXlm || "0"), // Pass as a string text token!
          imageUrl: watchAllFields.imageUrl || "",
          category: watchAllFields.category || "",
          previewText: watchAllFields.previewText || "",
          coCreators: watchAllFields.coCreators || [],
        },
        { offChainStorage },
      ),
    [watchAllFields, offChainStorage],
  );

  const checklistHasFailures = checklistItems.some((i) => i.status === "fail");
  
  const coCreatorsList = watchAllFields.coCreators || [];
  const totalRevenueSharePercent = useMemo(
    () =>
      coCreatorsList.reduce(
        (sum: number, coCreator: any) => sum + (Number(coCreator?.sharePercent?.trim()) || 0),
        0,
      ),
    [coCreatorsList],
  );

  useEffect(() => {
    draftLoadRef.current = null;
    setDraftRestored(false);
    setLastSavedAt(null);

    if (!draftStorageKey) {
      return;
    }

    const rawDraft = window.localStorage.getItem(draftStorageKey);
    if (!rawDraft) {
      draftLoadRef.current = draftStorageKey;
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft);
      if (parsed.formData) {
        Object.keys(parsed.formData).forEach((key) => {
          setValue(key, parsed.formData[key]);
        });
        setDraftRestored(true);
        setLastSavedAt(parsed.savedAt ?? null);
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    } finally {
      draftLoadRef.current = draftStorageKey;
    }
  }, [draftStorageKey, setValue]);

  const onSubmit = async (data: any) => {
    setSubmitError(null);
    setSuccessMessage(null);
    console.log("Form submitted successfully:", data);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        {showOnboarding && (
          <CreatorOnboarding
            isFirstListing={isFirstListing}
            {...({ onDismiss: () => setShowOnboarding(false) } as any)}
          />
        )}

        {!isConfigured && (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 mb-4">
            Connect your wallet and configure `PUBLIC_PROMPT_HASH_CONTRACT_ID` plus `PUBLIC_UNLOCK_PUBLIC_KEY` before listing prompts.
          </div>
        )}

        {(draftRestored || lastSavedAt) && isConfigured && (
          <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2.5 text-xs text-cyan-100 mb-4">
            {draftRestored ? (
              <>
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                Draft restored from {lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "previous session"}
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Draft saved {lastSavedAt ? new Date(lastSavedAt).toLocaleString() : ""}
              </>
            )}
            <button
              type="button"
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
              type="url"
              placeholder="https://example.com/prompt-cover.png"
              {...register("imageUrl")}
            />
            {errors.imageUrl && <p className="text-sm text-red-400">{errors.imageUrl.message?.toString()}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium text-slate-100">
              Title <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Input
              id="title"
              placeholder="Board-ready launch plan"
              className={errors.title ? "border-red-500" : ""}
              {...register("title")}
            />
            <p className="text-xs text-slate-400">/{limits.title}</p>
            {errors.title && (
              <p className="flex items-center gap-1 text-sm text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.title.message?.toString()}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_220px] mt-4">
          <div className="space-y-2">
            <label htmlFor="previewText" className="text-sm font-medium text-slate-100">
              Preview text <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Textarea
              id="previewText"
              placeholder="This public preview is visible on browse cards and modals."
              rows={4}
              className={errors.previewText ? "border-red-500" : ""}
              {...register("previewText")}
            />
            <p className="text-xs text-slate-400">/{limits.preview}</p>
            {errors.previewText && (
              <p className="flex items-center gap-1 text-sm text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.previewText.message?.toString()}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="category" className="text-sm font-medium text-slate-100">
              Category <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Controller
              name="category"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger id="category" aria-label="Prompt category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />

            <label htmlFor="priceXlm" className="pt-3 text-sm font-medium text-slate-100 block">
              Price in XLM <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <Input
              id="priceXlm"
              type="number"
              inputMode="decimal"
              placeholder="2.5"
              className={errors.priceXlm ? "border-red-500" : ""}
              {...register("priceXlm")}
            />
            {errors.priceXlm && (
              <p className="flex items-center gap-1 text-sm text-red-400 mt-1">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.priceXlm.message?.toString()}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2 mt-4">
          <div className="flex items-center justify-between">
            <label htmlFor="description" className="text-sm font-medium text-slate-100">
              Description <span className="text-slate-500 font-normal">(Markdown supported)</span>
            </label>
            <div className="flex gap-1 rounded-lg border border-white/10 p-0.5 bg-slate-900/60">
              <button
                type="button"
                onClick={() => setDescriptionTab("write")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  descriptionTab === "write" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Pencil className="h-3 w-3" /> Write
              </button>
              <button
                type="button"
                onClick={() => setDescriptionTab("preview")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  descriptionTab === "preview" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Eye className="h-3 w-3" /> Preview
              </button>
            </div>
          </div>
          {descriptionTab === "write" ? (
            <Textarea
              id="description"
              placeholder="Describe your prompt in detail. **Bold**, *italics*, `code`, and lists all work."
              rows={6}
              {...register("description")}
            />
          ) : (
            <div className="min-h-[144px] rounded-md border border-white/10 bg-slate-900/40 p-3">
              {watchAllFields.description ? (
                <MarkdownContent>{watchAllFields.description}</MarkdownContent>
              ) : (
                <p className="text-sm text-slate-500 italic">Nothing to preview yet — write some Markdown first.</p>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">
            {(watchAllFields.description || "").length} / 4000 characters
          </p>
          {errors.description && <p className="text-sm text-red-400">{errors.description.message?.toString()}</p>}
        </div>

        <PricingGuidance currentPriceXlm={watchAllFields.priceXlm} />

        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-100">Co-creators and revenue splits</h3>
              <p className="text-xs text-slate-400">Share a portion of each sale with collaborators.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={coCreatorsList.length >= LISTING_LIMITS.maxCoCreators}
              onClick={() => setValue("coCreators", [...coCreatorsList, { address: "", sharePercent: "" }])}
            >
              <Plus className="h-4 w-4" /> Add co-creator
            </Button>
          </div>

          {coCreatorsList.length > 0 ? (
            <div className="space-y-3">
              {coCreatorsList.map((coCreator: any, index: number) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">Stellar address</label>
                    <Input
                      placeholder="G..."
                      {...register(`coCreators.${index}.address`)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">Share %</label>
                    <Input
                      inputMode="decimal"
                      placeholder="15"
                      {...register(`coCreators.${index}.sharePercent`)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3 text-slate-300 hover:text-white"
                      onClick={() => setValue("coCreators", coCreatorsList.filter((_: any, i: number) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Add collaborators here when a prompt has multiple creators.</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Total shared: {totalRevenueSharePercent.toFixed(2)}%</span>
            <span>Primary creator keeps: {Math.max(0, 100 - totalRevenueSharePercent).toFixed(2)}%</span>
          </div>
        </div>

        <div className="space-y-2 mt-4">
          <label htmlFor="fullPrompt" className="text-sm font-medium text-slate-100">
            Full prompt <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <Textarea
            id="fullPrompt"
            rows={12}
            placeholder="This plaintext is encrypted in the browser, then only encrypted fields are sent on-chain."
            className={errors.fullPrompt ? "border-red-500" : ""}
            {...register("fullPrompt")}
          />
          {errors.fullPrompt && (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.fullPrompt.message?.toString()}
            </p>
          )}
        </div>

        {showChecklist && <ListingQualityChecklist items={checklistItems} />}

        <Button
          type="submit"
          className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300 mt-4"
          disabled={isSubmitting || (showChecklist && checklistHasFailures)}
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

        {submitError && (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200 mt-2">
            {submitError}
          </div>
        )}

        {successMessage && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 mt-2">
            {successMessage}
          </div>
        )}
      </div>
    </form>
  );
}
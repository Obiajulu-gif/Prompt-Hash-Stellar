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
  new Set(featuredPromptTemplates.map((p) => p.category)),
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
  const [stepIndex, setStepIndex] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    imageUrl: "",
    title: "",
    category: "",
    previewText: "",
    fullPrompt: "",
    priceXlm: "2",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successPromptId, setSuccessPromptId] = useState<string | null>(null);

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

  const currentStep = STEPS[stepIndex];

  // ── Field handlers ──────────────────────────────────────────────────────────
  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleCategoryChange = (value: string) => {
    setFormData((prev) => ({ ...prev, category: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.category;
      return next;
    });
  };

  // ── Per-step validation ─────────────────────────────────────────────────────
  const validateStep = (id: StepId): FormErrors => {
    const next: FormErrors = {};
    if (id === "basics") {
      if (!formData.imageUrl.trim())
        next.imageUrl = "Image URL is required.";
      else if (formData.imageUrl.length > limits.imageUrl)
        next.imageUrl = `Max ${limits.imageUrl} characters.`;

      if (!formData.title.trim()) next.title = "Title is required.";
      else if (formData.title.length > limits.title)
        next.title = `Max ${limits.title} characters.`;

      if (!formData.category) next.category = "Category is required.";
    }

    if (id === "content") {
      if (!formData.previewText.trim())
        next.previewText = "Preview text is required.";
      else if (formData.previewText.length > limits.preview)
        next.previewText = `Max ${limits.preview} characters.`;

      if (!formData.fullPrompt.trim())
        next.fullPrompt = "Full prompt content is required.";
    }

    if (id === "pricing") {
      try {
        const price = xlmToStroops(formData.priceXlm);
        if (price <= 0n) next.priceXlm = "Price must be greater than zero.";
      } catch (err) {
        next.priceXlm =
          err instanceof Error ? err.message : "Enter a valid XLM price.";
      }
    }

    return next;
  };

  const handleNext = () => {
    const errs = validateStep(currentStep.id);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setErrors({});
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitError(null);

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

      if (encrypted.encryptedPrompt.length > limits.encrypted) {
        throw new Error(
          "Encrypted payload is too large. Shorten the full prompt and try again.",
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
        err instanceof Error ? err.message : "Failed to create prompt.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (successPromptId !== null) {
    return (
      <div className="flex flex-col items-center gap-6 rounded-[2rem] border border-emerald-400/20 bg-emerald-500/10 px-8 py-14 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-300" />
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
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
            onClick={() => {
              setSuccessPromptId(null);
              setFormData({
                imageUrl: "",
                title: "",
                category: "",
                previewText: "",
                fullPrompt: "",
                priceXlm: "2",
              });
              setStepIndex(0);
            }}
          >
            Create another listing
          </Button>
          <Button
            variant="outline"
            className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
            onClick={onCreated}
          >
            View my prompts
          </Button>
        </div>
      </div>
    );
  }

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
            <FieldError message={errors.previewText} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-200">
              Full prompt{" "}
              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                <LockKeyhole className="h-2.5 w-2.5" />
                Encrypted in browser
              </span>
            </label>
            <Textarea
              name="fullPrompt"
              value={formData.fullPrompt}
              onChange={handleChange}
              rows={12}
              placeholder="Write your full prompt here. It will be AES-256-GCM encrypted in your browser — only the ciphertext is stored on-chain. Buyers unlock it with a wallet-signed challenge."
              className={`border-white/10 bg-white/5 font-mono text-sm text-slate-100 placeholder:font-sans placeholder:text-slate-600 ${errors.fullPrompt ? "border-red-500/60" : ""}`}
            />
            <div className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/5 px-3 py-2.5 text-xs text-slate-400">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              Your plaintext never leaves the browser unencrypted. The
              encryption key is wrapped with the platform public key so only
              wallet-verified buyers can decrypt.
            </div>
            <FieldError message={errors.fullPrompt} />
          </div>
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
      )}

      {/* ── Step: Publish / Review ── */}
      {currentStep.id === "publish" && (
        <div className="space-y-5">
          {/* Summary card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 divide-y divide-white/5">
            {formData.imageUrl && (
              <div className="aspect-video overflow-hidden rounded-t-2xl">
                <img
                  src={formData.imageUrl}
                  alt="Cover preview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "/images/codeguru.png";
                  }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-px">
              {[
                { label: "Title", value: formData.title },
                { label: "Category", value: formData.category },
                {
                  label: "Price",
                  value: `${formData.priceXlm} XLM`,
                },
                {
                  label: "Encryption",
                  value: "AES-256-GCM (browser)",
                },
              ].map(({ label, value }) => (
                <div key={label} className="px-5 py-4">
                  <p className="text-xs uppercase tracking-widest text-slate-500">
                    {label}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-100">
                    {value || "—"}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-5 py-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">
                Preview text
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-300">
                {formData.previewText || "—"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-emerald-400/10 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Submitting will encrypt your prompt in the browser and send only
            the ciphertext + wrapped key to the Soroban contract. Your wallet
            will prompt you to sign the transaction.
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              {submitError}
            </div>
          )}

          <Button
            className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
            disabled={isSubmitting || !isConfigured}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Encrypting and submitting…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Publish listing on-chain
              </>
            )}
          </Button>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="ghost"
          className="gap-1.5 text-slate-400 hover:text-slate-200"
          onClick={handleBack}
          disabled={stepIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        {stepIndex < STEPS.length - 1 && (
          <Button
            className="gap-1.5 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
            onClick={handleNext}
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

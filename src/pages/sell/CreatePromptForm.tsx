import { ChangeEvent, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Image,
  LockKeyhole,
  Loader2,
  Sparkles,
  Tag,
} from "lucide-react";
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

interface FormErrors {
  [key: string]: string;
}

interface Props {
  onCreated?: () => void;
}

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  {
    id: "basics",
    label: "Basics",
    icon: Image,
    description: "Title, category, and cover image",
  },
  {
    id: "content",
    label: "Content",
    icon: LockKeyhole,
    description: "Preview text and encrypted prompt",
  },
  {
    id: "pricing",
    label: "Pricing",
    icon: Tag,
    description: "Set your XLM listing price",
  },
  {
    id: "publish",
    label: "Publish",
    icon: Sparkles,
    description: "Review and submit on-chain",
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

function CharCount({ current, max }: { current: number; max: number }) {
  const pct = current / max;
  return (
    <span
      className={`text-xs tabular-nums ${
        pct >= 1
          ? "text-red-400"
          : pct >= 0.85
            ? "text-amber-400"
            : "text-slate-500"
      }`}
    >
      {current}/{max}
    </span>
  );
}

// ── Step progress bar ─────────────────────────────────────────────────────────
function StepBar({
  currentIndex,
  total,
}: {
  currentIndex: number;
  total: number;
}) {
  return (
    <div className="mb-8 flex items-center gap-0">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step.id} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all ${
                  done
                    ? "border-emerald-400 bg-emerald-400/20 text-emerald-300"
                    : active
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.3)]"
                      : "border-white/10 bg-white/5 text-slate-500"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={`hidden text-[10px] font-medium uppercase tracking-wider sm:block ${
                  active ? "text-emerald-300" : done ? "text-slate-400" : "text-slate-600"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < total - 1 && (
              <div
                className={`mx-1 h-px flex-1 transition-all ${
                  i < currentIndex ? "bg-emerald-400/40" : "bg-white/10"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CreatePromptForm({ onCreated }: Props) {
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

      setSuccessPromptId(promptId.toString());
    } catch (err) {
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
        <div>
          <h2 className="text-2xl font-semibold text-white">
            Listing published on-chain
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Prompt #{successPromptId} is now live. Buyers can discover and
            purchase a license from the browse page.
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

  return (
    <div className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 sm:p-8">
      <StepBar currentIndex={stepIndex} total={STEPS.length} />

      {/* Step header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">
          {currentStep.label}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {currentStep.description}
        </p>
      </div>

      {/* Wallet warning */}
      {!isConfigured && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>
            Connect your wallet and configure{" "}
            <code className="rounded bg-amber-400/10 px-1 text-xs">
              PUBLIC_PROMPT_HASH_CONTRACT_ID
            </code>{" "}
            and{" "}
            <code className="rounded bg-amber-400/10 px-1 text-xs">
              PUBLIC_UNLOCK_PUBLIC_KEY
            </code>{" "}
            before listing prompts.
          </span>
        </div>
      )}

      {/* ── Step: Basics ── */}
      {currentStep.id === "basics" && (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-200">
              Cover image URL
            </label>
            <Input
              name="imageUrl"
              value={formData.imageUrl}
              onChange={handleChange}
              placeholder="https://example.com/prompt-cover.png"
              className={`border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-600 ${errors.imageUrl ? "border-red-500/60" : ""}`}
            />
            <p className="text-xs text-slate-500">
              A square or 16:9 image works best on browse cards.
            </p>
            <FieldError message={errors.imageUrl} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200">
                Title
              </label>
              <CharCount
                current={formData.title.length}
                max={limits.title}
              />
            </div>
            <Input
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="Board-ready launch plan"
              className={`border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-600 ${errors.title ? "border-red-500/60" : ""}`}
            />
            <FieldError message={errors.title} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-200">
              Category
            </label>
            <Select
              value={formData.category}
              onValueChange={handleCategoryChange}
            >
              <SelectTrigger
                className={`border-white/10 bg-white/5 text-slate-100 ${errors.category ? "border-red-500/60" : ""}`}
              >
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
            <FieldError message={errors.category} />
          </div>
        </div>
      )}

      {/* ── Step: Content ── */}
      {currentStep.id === "content" && (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200">
                Preview text
              </label>
              <CharCount
                current={formData.previewText.length}
                max={limits.preview}
              />
            </div>
            <Textarea
              name="previewText"
              value={formData.previewText}
              onChange={handleChange}
              rows={4}
              placeholder="Describe what buyers get — this is visible on browse cards before purchase."
              className={`border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-600 ${errors.previewText ? "border-red-500/60" : ""}`}
            />
            <p className="text-xs text-slate-500">
              This public teaser appears on browse cards and listing modals.
              Keep it compelling but don't give away the full prompt.
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
      )}

      {/* ── Step: Pricing ── */}
      {currentStep.id === "pricing" && (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-200">
              Price (XLM)
            </label>
            <div className="relative">
              <Input
                name="priceXlm"
                value={formData.priceXlm}
                onChange={handleChange}
                placeholder="2.5"
                className={`border-white/10 bg-white/5 pr-14 text-slate-100 placeholder:text-slate-600 ${errors.priceXlm ? "border-red-500/60" : ""}`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                XLM
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Buyers pay this amount in XLM to receive a license. You can
              update the price at any time from My Prompts.
            </p>
            <FieldError message={errors.priceXlm} />
          </div>

          {/* Pricing context card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm">
            <p className="font-medium text-slate-200">How pricing works</p>
            <ul className="mt-3 space-y-2 text-slate-400">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                Buyers pay XLM directly to the smart contract.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                Access is recorded on-chain — no re-purchase needed.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                You can pause or reactivate listings at any time.
              </li>
            </ul>
          </div>
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

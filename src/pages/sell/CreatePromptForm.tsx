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

  const checklistItems = buildChecklistItems(formData.title, formData.description, formData.priceXlm, formData.fullPrompt);
  const checklistHasFailures = checklistItems.some(i => !i.met);

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);

    // Run basic validation
    const formErrors = validateListingForm(formData);
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      setSubmitError("Please fix the validation errors before submitting.");
      return;
    }

    if (showChecklist && checklistHasFailures) {
      setSubmitError("Please resolve checklist issues before listing.");
      return;
    }

    if (!address || !signTransaction) {
      setSubmitError("Please connect your wallet to create a listing.");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Encrypt the prompt content
      const { keyBytes, encryptedPrompt, encryptionIv, contentHash } = await encryptPromptPlaintext(formData.fullPrompt);

      // 2. Wrap the AES key with the platform's public key
      const wrappedKey = await wrapPromptKey(keyBytes, unlockPublicKey);

      // 3. Upload to IPFS if configured
      let payloadForChain = encryptedPrompt;
      if (isIpfsUploadConfigured()) {
        const ipfsResult = await uploadCiphertextToIpfs(encryptedPrompt, { name: formData.title });
        payloadForChain = ipfsResult.uri;
      } else {
        // Fallback to inline storage
        const errors = validateEncryptedPayload(encryptedPrompt, wrappedKey);
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }

      // 4. Submit to Soroban
      const priceStroops = BigInt(xlmToStroops(formData.priceXlm));
      const txResult = await createPrompt(
        browserStellarConfig,
        { signTransaction },
        address,
        {
          title: formData.title,
          category: formData.category,
          previewText: formData.previewText,
          imageUrl: formData.imageUrl,
          priceStroops,
          encryptedPrompt: payloadForChain,
          encryptionIv,
          wrappedKey,
          contentHash,
          splits: [], // Co-creators can be mapped here if needed
        }
      );

      if (txResult.success) {
        setSuccessMessage("Listing created successfully!");
        if (onCreated) onCreated();
        navigate("/dashboard"); // Or wherever the user should go
      } else {
        throw new Error("Transaction failed on-chain.");
      }
    } catch (err: any) {
      setSubmitError(err.message || "An unknown error occurred during creation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ... form JSX ... */}

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
  );
}

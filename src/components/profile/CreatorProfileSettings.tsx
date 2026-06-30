import { ChangeEvent, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface CreatorProfileData {
  displayName: string;
  bio: string;
  websiteUrl: string;
  avatarUrl: string;
  twitterHandle: string;
}

interface CreatorProfileSettingsProps {
  walletAddress: string;
  initial?: Partial<CreatorProfileData>;
  onSave?: (_data: CreatorProfileData) => Promise<void>;
}

const DISPLAY_NAME_MAX = 50;
const BIO_MAX = 280;

function validate(data: CreatorProfileData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.displayName.trim()) {
    errors.displayName = "Display name is required.";
  } else if (data.displayName.trim().length > DISPLAY_NAME_MAX) {
    errors.displayName = `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`;
  }

  if (data.bio.length > BIO_MAX) {
    errors.bio = `Bio must be ${BIO_MAX} characters or fewer.`;
  }

  if (data.websiteUrl && !/^https?:\/\/.+/.test(data.websiteUrl.trim())) {
    errors.websiteUrl = "Website must start with http:// or https://";
  }

  if (data.avatarUrl && !/^https?:\/\/.+/.test(data.avatarUrl.trim())) {
    errors.avatarUrl = "Avatar URL must start with http:// or https://";
  }

  if (data.twitterHandle && !/^@?[A-Za-z0-9_]{1,15}$/.test(data.twitterHandle.trim())) {
    errors.twitterHandle = "Enter a valid Twitter handle (1–15 alphanumeric characters).";
  }

  return errors;
}

const STORAGE_KEY = (address: string) => `prompt-hash:profile:${address}`;

function loadSaved(address: string): Partial<CreatorProfileData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(address));
    return raw ? (JSON.parse(raw) as Partial<CreatorProfileData>) : {};
  } catch {
    return {};
  }
}

export function CreatorProfileSettings({
  walletAddress,
  initial,
  onSave,
}: CreatorProfileSettingsProps) {
  const savedData = loadSaved(walletAddress);

  const [form, setForm] = useState<CreatorProfileData>({
    displayName: initial?.displayName ?? savedData.displayName ?? "",
    bio: initial?.bio ?? savedData.bio ?? "",
    websiteUrl: initial?.websiteUrl ?? savedData.websiteUrl ?? "",
    avatarUrl: initial?.avatarUrl ?? savedData.avatarUrl ?? "",
    twitterHandle: initial?.twitterHandle ?? savedData.twitterHandle ?? "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setSaved(false);
  };

  const handleSubmit = async () => {
    setSaveError(null);
    setSaved(false);

    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      if (onSave) {
        await onSave(form);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        localStorage.setItem(STORAGE_KEY(walletAddress), JSON.stringify(form));
      }
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Profile settings</h2>
        <p className="mt-1 text-sm text-slate-400">
          Update how you appear to buyers on the marketplace.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="displayName" className="text-sm font-medium text-slate-200">
            Display name <span className="text-red-400">*</span>
          </label>
          <Input
            id="displayName"
            name="displayName"
            value={form.displayName}
            onChange={handleChange}
            placeholder="e.g. StellarDev42"
            className={errors.displayName ? "border-red-500" : ""}
          />
          <div className="flex justify-between">
            {errors.displayName ? (
              <p className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.displayName}
              </p>
            ) : (
              <span />
            )}
            <span className="text-xs text-slate-500">
              {form.displayName.length}/{DISPLAY_NAME_MAX}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="twitterHandle" className="text-sm font-medium text-slate-200">
            Twitter / X handle
          </label>
          <Input
            id="twitterHandle"
            name="twitterHandle"
            value={form.twitterHandle}
            onChange={handleChange}
            placeholder="@yourhandle"
            className={errors.twitterHandle ? "border-red-500" : ""}
          />
          {errors.twitterHandle && (
            <p className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.twitterHandle}
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="bio" className="text-sm font-medium text-slate-200">
            Bio
          </label>
          <Textarea
            id="bio"
            name="bio"
            value={form.bio}
            onChange={handleChange}
            placeholder="Tell buyers what kind of prompts you create…"
            rows={3}
            className={errors.bio ? "border-red-500" : ""}
          />
          <div className="flex justify-between">
            {errors.bio ? (
              <p className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.bio}
              </p>
            ) : (
              <span />
            )}
            <span className="text-xs text-slate-500">
              {form.bio.length}/{BIO_MAX}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="websiteUrl" className="text-sm font-medium text-slate-200">
            Website
          </label>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            value={form.websiteUrl}
            onChange={handleChange}
            placeholder="https://yoursite.com"
            className={errors.websiteUrl ? "border-red-500" : ""}
          />
          {errors.websiteUrl && (
            <p className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.websiteUrl}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="avatarUrl" className="text-sm font-medium text-slate-200">
            Avatar URL
          </label>
          <Input
            id="avatarUrl"
            name="avatarUrl"
            type="url"
            value={form.avatarUrl}
            onChange={handleChange}
            placeholder="https://example.com/avatar.png"
            className={errors.avatarUrl ? "border-red-500" : ""}
          />
          {errors.avatarUrl && (
            <p className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.avatarUrl}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          onClick={() => void handleSubmit()}
          disabled={saving}
          className="h-10 bg-emerald-400 text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save profile
            </>
          )}
        </Button>

        {saved && !saving && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Profile saved
          </p>
        )}

        {saveError && (
          <p className="flex items-center gap-1.5 text-sm text-red-400">
            <AlertCircle className="h-4 w-4" />
            {saveError}
          </p>
        )}
      </div>
    </section>
  );
}

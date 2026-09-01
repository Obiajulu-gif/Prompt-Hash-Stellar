import React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, LifeBuoy, LockKeyhole, Wallet } from "lucide-react";
import { classifyUnlockError, type UnlockErrorCategory } from "@/lib/api/errorCodes";
import { getUnlockErrorMeta } from "@/lib/errors/unlockErrors";

interface UnlockErrorLike {
  code?: string;
  message: string;
  correlationId?: string;
  category?: UnlockErrorCategory;
  retryable?: boolean;
}

interface UnlockErrorBannerProps {
  /** Structured unlock failure. Falls back to `message` for plain errors. */
  error?: UnlockErrorLike;
  /** Plain error message shown when `error` is omitted. */
  message?: string;
  onRetry?: () => void;
}

export const UnlockErrorBanner: React.FC<UnlockErrorBannerProps> = ({
  error,
  message,
  onRetry,
}) => {
  const { t } = useTranslation();
  const rawMessage = error?.message ?? message ?? t("unlockErrors.unknown");

  const metaCode = error?.code ? getUnlockErrorMeta(error.code) : null;
  const category: UnlockErrorCategory =
    error?.category ?? metaCode?.category ?? classifyUnlockError(rawMessage);
  const retryable = error?.retryable ?? metaCode?.retryable ?? true;

  const localizedMessage = error?.code
    ? t(`unlockErrors.codes.${error.code}`)
    : rawMessage;
  const displayMessage =
    localizedMessage &&
    !localizedMessage.startsWith("unlockErrors.codes.") &&
    localizedMessage.length > 0
      ? localizedMessage
      : rawMessage;

  const supportReference = error?.correlationId
    ? t("unlockErrors.withSupportReference", {
        correlationId: error.correlationId,
      })
    : null;

  const config = {
    wallet: {
      icon: <Wallet className="h-4 w-4 shrink-0 text-amber-400" />,
      label: t("unlockErrors.categories.wallet"),
      classes: "bg-amber-900/20 border-amber-500/30 text-amber-200",
      labelClass: "text-amber-400",
      retryClass: "bg-amber-500/20 hover:bg-amber-500/40 text-amber-300",
    },
    access: {
      icon: <LockKeyhole className="h-4 w-4 shrink-0 text-red-400" />,
      label: t("unlockErrors.categories.access"),
      classes: "bg-red-900/20 border-red-500/30 text-red-200",
      labelClass: "text-red-400",
      retryClass: "bg-red-500/20 hover:bg-red-500/40 text-red-300",
    },
    server: {
      icon: <AlertCircle className="h-4 w-4 shrink-0 text-slate-400" />,
      label: t("unlockErrors.categories.server"),
      classes: "bg-slate-800/60 border-slate-500/30 text-slate-300",
      labelClass: "text-slate-400",
      retryClass: "bg-slate-500/20 hover:bg-slate-500/40 text-slate-300",
    },
  }[category];

  return (
    <div
      className={`rounded-lg p-4 border flex items-start gap-3 w-full ${config.classes}`}
      role="alert"
      aria-live="polite"
    >
      {config.icon}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${config.labelClass}`}>
          {config.label}
        </p>
        <p className="text-sm">{displayMessage}</p>
        {supportReference && (
          <p className="text-xs text-slate-400 mt-1">{supportReference}</p>
        )}
      </div>
      {retryable && onRetry && (
        <button
          onClick={onRetry}
          className={`ml-2 shrink-0 px-3 py-1.5 text-sm font-bold rounded transition-colors ${config.retryClass}`}
        >
          {t("common.retry")}
        </button>
      )}
      {!retryable && (
        <span className="ml-2 shrink-0 flex items-center gap-1 text-xs text-slate-400">
          <LifeBuoy className="h-3.5 w-3.5" />
          {t("unlockErrors.contactSupport")}
        </span>
      )}
    </div>
  );
};
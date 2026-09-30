import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  X,
  Loader2,
  CheckCircle,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportClient, REPORT_REASONS, type ReportReason, type ReportEvidence } from "@/lib/reports/reportClient";
import { createFocusTrap, setFocusOn } from "@/lib/accessibility/formHelpers";

export interface ReportDialogProps {
  promptId: string;
  isOpen: boolean;
  onClose: () => void;
  userAddress?: string;
}

type DialogStage = "form" | "submitting" | "success";

export function ReportDialog({
  promptId,
  isOpen,
  onClose,
  userAddress,
}: ReportDialogProps) {
  const [stage, setStage] = useState<DialogStage>("form");
  const [selectedReason, setSelectedReason] = useState<ReportReason | "">(
    ""
  );
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidence, setEvidence] = useState<ReportEvidence[]>([]);
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addEvidence = () => {
    const url = evidenceUrl.trim();
    if (!url) return;
    setEvidence((prev) => [...prev, { url, kind: "link" }]);
    setEvidenceUrl("");
  };

  const handleSubmit = async () => {
    setError("");

    if (!selectedReason) {
      setError("Please select a reason");
      return;
    }

    if (!userAddress) {
      setError("Please connect your wallet");
      return;
    }

    setIsSubmitting(true);
    setStage("submitting");

    try {
      await ReportClient.submitReport(
        promptId,
        userAddress,
        selectedReason as ReportReason,
        description,
        evidence.length ? evidence : undefined
      );

      setStage("success");
      setTimeout(() => {
        onClose();
        // Reset form
        setStage("form");
        setSelectedReason("");
        setDescription("");
        setEvidenceUrl("");
        setEvidence([]);
        setError("");
      }, 2000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit report"
      );
      setStage("form");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const titleId = `report-dialog-title-${promptId}`;
  const descId = `report-dialog-desc-${promptId}`;
  const errorId = `report-dialog-error-${promptId}`;

  return (
    <ReportDialogShell
      promptId={promptId}
      onClose={onClose}
      titleId={titleId}
      descId={descId}
      errorId={errorId}
      stage={stage}
      selectedReason={selectedReason}
      setSelectedReason={setSelectedReason}
      description={description}
      setDescription={setDescription}
      evidenceUrl={evidenceUrl}
      setEvidenceUrl={setEvidenceUrl}
      evidence={evidence}
      setEvidence={setEvidence}
      error={error}
      isSubmitting={isSubmitting}
      handleSubmit={handleSubmit}
      addEvidence={addEvidence}
    />
  );
}

interface ShellProps {
  promptId: string;
  onClose: () => void;
  titleId: string;
  descId: string;
  errorId: string;
  stage: DialogStage;
  selectedReason: ReportReason | "";
  setSelectedReason: (r: ReportReason | "") => void;
  description: string;
  setDescription: (v: string) => void;
  evidenceUrl: string;
  setEvidenceUrl: (v: string) => void;
  evidence: ReportEvidence[];
  setEvidence: React.Dispatch<React.SetStateAction<ReportEvidence[]>>;
  error: string;
  isSubmitting: boolean;
  handleSubmit: () => void;
  addEvidence: () => void;
}

function ReportDialogShell({
  onClose,
  titleId,
  descId,
  errorId,
  stage,
  selectedReason,
  setSelectedReason,
  description,
  setDescription,
  evidenceUrl,
  setEvidenceUrl,
  evidence,
  setEvidence,
  error,
  isSubmitting,
  handleSubmit,
  addEvidence,
}: ShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    setFocusOn(firstFocusable ?? null);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
        onKeyDown={(e) => {
          if (!dialogRef.current) return;
          createFocusTrap(dialogRef.current).handleKeyDown(e.nativeEvent);
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-white transition-colors"
          aria-label="Close report dialog"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="p-6 sm:p-8">
          {/* FORM STAGE */}
          {stage === "form" && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden="true" />
                  <h2 id={titleId} className="text-xl font-bold text-white">Report Prompt</h2>
                </div>
                <p id={descId} className="text-sm text-slate-400">
                  Help us maintain quality by reporting issues with this prompt
                </p>
              </div>

              {/* Reason Selector — radio group pattern */}
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  What's the issue? <span aria-hidden="true" className="text-amber-400">*</span>
                </legend>
                <div role="radiogroup" aria-required="true" className="space-y-2">
                  {Object.entries(REPORT_REASONS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={selectedReason === key}
                      onClick={() => setSelectedReason(key as ReportReason)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                        selectedReason === key
                          ? "border-emerald-500/50 bg-emerald-500/10"
                          : "border-white/10 bg-white/5 hover:bg-white/[0.08]"
                      }`}
                    >
                      <div
                        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          selectedReason === key
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-white/20"
                        }`}
                        aria-hidden="true"
                      >
                        {selectedReason === key && (
                          <div className="h-2 w-2 bg-white rounded-full" />
                        )}
                      </div>
                      <span className="text-sm text-white flex-1">{label}</span>
                      <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="report-description" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Additional details (optional)
                </label>
                <textarea
                  id="report-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Please provide any additional information..."
                  maxLength={500}
                  aria-describedby="report-description-count"
                  className="w-full h-24 px-4 py-3 rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <p id="report-description-count" className="text-xs text-slate-500 text-right">
                  {description.length}/500
                </p>
              </div>

              {/* Evidence */}
              <div className="space-y-2">
                <label htmlFor="report-evidence" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Evidence links (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    id="report-evidence"
                    type="url"
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addEvidence();
                      }
                    }}
                    placeholder="https://..."
                    aria-describedby="report-evidence-hint"
                    className="flex-1 px-4 py-3 rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addEvidence}
                    disabled={!evidenceUrl.trim()}
                    className="px-3"
                  >
                    Add
                  </Button>
                </div>
                <p id="report-evidence-hint" className="text-xs text-slate-500">
                  Up to 10 evidence links help our moderation team verify your report. Press Enter or click Add.
                </p>
                {evidence.length > 0 && (
                  <ul className="space-y-1.5" aria-label="Added evidence links">
                    {evidence.map((item, index) => (
                      <li
                        key={`${item.url}-${index}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                      >
                        <span className="truncate text-slate-300">{item.url}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setEvidence((prev) => prev.filter((_, i) => i !== index))
                          }
                          className="ml-2 shrink-0 text-slate-500 hover:text-red-400 transition-colors"
                          aria-label={`Remove evidence link: ${item.url}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Error */}
              {error && (
                <div
                  id={errorId}
                  role="alert"
                  aria-live="assertive"
                  aria-atomic="true"
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400"
                >
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!selectedReason || isSubmitting}
                  aria-busy={isSubmitting}
                  aria-describedby={error ? errorId : undefined}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                >
                  Submit Report
                </Button>
              </div>
            </div>
          )}

          {/* SUBMITTING STAGE */}
          {stage === "submitting" && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Submitting report, please wait"
              className="flex flex-col items-center justify-center py-12 space-y-4 text-center"
            >
              <div className="relative">
                <Loader2 className="h-12 w-12 text-amber-500 animate-spin" aria-hidden="true" />
                <div className="absolute inset-0 blur-xl bg-amber-500/20" aria-hidden="true" />
              </div>
              <p className="text-white font-semibold">Submitting report...</p>
              <p className="text-sm text-slate-400">
                Please wait while we process your report
              </p>
            </div>
          )}

          {/* SUCCESS STAGE */}
          {stage === "success" && (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center justify-center py-12 space-y-4 text-center animate-in fade-in zoom-in"
            >
              <div className="p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle className="h-8 w-8 text-emerald-400" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Report Received</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Thank you for helping us maintain quality. Our team will review
                  this promptly.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

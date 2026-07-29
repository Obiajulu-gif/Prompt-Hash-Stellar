import React from "react";
import { CheckCircle, Clock, ExternalLink, Check, Copy } from "lucide-react";
import { stroopsToXlmString } from "../../lib/stellar/format";
import { browserStellarConfig } from "../../lib/stellar/browserConfig";

// Small inline copy button
const CopyField: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // silent
    }
  };
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label}`}
      className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
      data-testid={`copy-${label.replace(/\s+/g, "-")}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
};

interface PurchaseReceiptProps {
  promptDetail: any;
  itemId: string;
  walletAddress: string;
  txHash: string;
  isPendingIndexing?: boolean;
}

export const PurchaseReceipt: React.FC<PurchaseReceiptProps> = ({
  promptDetail,
  itemId,
  walletAddress,
  txHash,
  isPendingIndexing = false,
}) => {
  const priceXlm = promptDetail ? stroopsToXlmString(promptDetail.priceStroops) : "—";
  // Assuming a fixed platform fee representation or extracting from metadata if available
  const feeXlm = promptDetail ? stroopsToXlmString((BigInt(promptDetail.priceStroops) * 5n) / 100n) : "—"; // Example 5% fee

  return (
    <div className="animate-in fade-in zoom-in duration-300 space-y-4" data-testid="purchase-receipt">
      {/* Receipt header */}
      <div className={`rounded-2xl border p-4 ${isPendingIndexing ? 'border-amber-500/20 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
        <div className={`flex items-center gap-2 font-bold mb-3 ${isPendingIndexing ? 'text-amber-400' : 'text-emerald-400'}`}>
          {isPendingIndexing ? <Clock className="h-5 w-5" /> : <CheckCircle className="h-5 w-5" />} 
          {isPendingIndexing ? "Pending Indexing..." : "Purchase Receipt"}
        </div>
        
        {isPendingIndexing && (
          <p className="text-xs text-amber-300 mb-4 leading-relaxed">
            Your transaction was successful on the Stellar network, but our system is still indexing the update. 
            You will be able to unlock the prompt shortly.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-slate-400 uppercase tracking-wider mb-1">Prompt</p>
            <p className="font-semibold text-white truncate" title={promptDetail?.title ?? `#${itemId}`}>
              {promptDetail?.title ?? `#${itemId}`}
            </p>
          </div>
          <div>
            <p className="text-slate-400 uppercase tracking-wider mb-1">Creator</p>
            <p className="font-semibold text-white truncate" title={promptDetail?.creator}>
              {promptDetail?.creator ? `${promptDetail.creator.slice(0, 6)}…${promptDetail.creator.slice(-4)}` : "—"}
            </p>
          </div>
          <div>
            <p className="text-slate-400 uppercase tracking-wider mb-1">Amount</p>
            <p className="font-semibold text-emerald-300">
              {priceXlm} XLM
            </p>
          </div>
          <div>
            <p className="text-slate-400 uppercase tracking-wider mb-1">Network Fee</p>
            <p className="font-semibold text-slate-300">
              {feeXlm} XLM
            </p>
          </div>
        </div>
      </div>

      {/* Reference details — copyable */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Transaction details</p>
        
        {txHash && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-slate-500">Transaction hash</p>
              <div className="flex items-center gap-2">
                <a
                  href={`https://stellar.expert/explorer/${browserStellarConfig.networkPhrase.includes('TESTNET') ? 'testnet' : 'public'}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-blue-400 hover:text-blue-300 truncate underline decoration-blue-400/30 underline-offset-2"
                >
                  {txHash.slice(0, 16)}…
                </a>
                <ExternalLink className="h-3 w-3 text-slate-500" />
              </div>
            </div>
            <CopyField value={txHash} label="tx hash" />
          </div>
        )}
        
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500">Prompt ID</p>
            <p className="font-mono text-xs text-slate-300">#{itemId}</p>
          </div>
          <CopyField value={itemId} label="prompt ID" />
        </div>
        
        {promptDetail?.contentHash && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-slate-500">Content hash</p>
              <p className="font-mono text-xs text-slate-300 truncate">
                {promptDetail.contentHash.slice(0, 16)}…
              </p>
            </div>
            <CopyField value={promptDetail.contentHash} label="content hash" />
          </div>
        )}
      </div>
    </div>
  );
};

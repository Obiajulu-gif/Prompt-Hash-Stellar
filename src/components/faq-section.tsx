"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

type FaqItem = { question: string; answer: string };

const buyerFaqs: FaqItem[] = [
  {
    question: "What is XLM and do I need it to buy prompts?",
    answer:
      "XLM (Lumens) is the native token of the Stellar network. Yes — all purchases on PromptHash are settled in XLM. You'll need a Stellar-compatible wallet with a small XLM balance to cover the prompt price plus a negligible network fee (typically < 0.001 XLM).",
  },
  {
    question: "How do I purchase a prompt?",
    answer:
      "Connect your Stellar wallet, browse the marketplace, and click 'Buy Access' on any listing. Your wallet will prompt you to sign a transaction. Once the Soroban contract confirms payment, you can unlock and view the full prompt text immediately.",
  },
  {
    question: "What do I actually receive after purchasing?",
    answer:
      "You receive a license to use the prompt — not ownership of it. The contract records your wallet address as a verified buyer, which lets the unlock API decrypt and return the plaintext to you at any time.",
  },
  {
    question: "Can I re-sell or transfer my access?",
    answer:
      "License transferability depends on the terms the creator set when listing. Some prompts allow resale (with automatic royalties back to the creator); others are bound to the purchasing wallet. Check the listing details before buying.",
  },
  {
    question: "What happens if I lose access to my wallet?",
    answer:
      "Access is tied to your wallet's public key. If you lose the private key you will not be able to prove ownership and unlock the prompt. Always keep your seed phrase backed up securely.",
  },
  {
    question: "Are refunds available?",
    answer:
      "Because payments settle instantly on-chain and prompt content is revealed to the buyer at the moment of purchase, refunds cannot be processed automatically. Contact the creator directly if you have a dispute.",
  },
];

const creatorFaqs: FaqItem[] = [
  {
    question: "How are my prompts protected from theft?",
    answer:
      "Your prompt text is encrypted with AES-GCM in your browser before upload. Only the ciphertext is stored — on-chain and in our database. The plaintext is never exposed without a valid on-chain purchase proof, so even PromptHash staff cannot read it.",
  },
  {
    question: "How do I earn revenue from my prompts?",
    answer:
      "Set a price in XLM when listing your prompt. Every time a buyer purchases access the Soroban contract transfers the XLM directly to your wallet, minus the configurable platform fee. No withdrawal step needed — it's instant.",
  },
  {
    question: "Can I sell the same prompt to multiple buyers?",
    answer:
      "Yes — that's the core model. You publish once and the contract tracks an unlimited number of independent buyers. You keep creative ownership while each buyer receives their own access license.",
  },
  {
    question: "What happens if I update or delete a prompt?",
    answer:
      "Buyers who already purchased retain their access rights. If you update the prompt text, existing buyers will see the new version when they next unlock it. Delisting a prompt removes it from discovery but does not revoke existing licenses.",
  },
  {
    question: "How do I configure revenue splits with collaborators?",
    answer:
      "When creating a listing you can specify multiple recipient addresses and their percentage shares in the fee-split field. The Soroban contract enforces these splits in stroops so every payout is transparent and automatic.",
  },
  {
    question: "Is there a minimum price I must charge?",
    answer:
      "There is no hard minimum enforced by the platform, but Stellar requires every transaction to cover the base network fee (~0.00001 XLM). Setting a price of 0 XLM is technically possible but means you earn nothing from purchases.",
  },
];

type TabKey = "buyers" | "creators";

interface AccordionProps {
  items: FaqItem[];
  prefix: string;
}

function Accordion({ items, prefix }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="divide-y divide-white/10">
      {items.map((faq, index) => {
        const isOpen = openIndex === index;
        const btnId = `${prefix}-btn-${index}`;
        const panelId = `${prefix}-panel-${index}`;
        return (
          <div key={index} className="py-5">
            <button
              id={btnId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-base font-medium text-white">
                {faq.question}
              </h3>
              <ChevronDown
                className={`size-5 shrink-0 text-amber-400 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              hidden={!isOpen}
              className="mt-3 text-sm leading-relaxed text-slate-400"
            >
              <p>{faq.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function FaqSection() {
  const [tab, setTab] = useState<TabKey>("buyers");

  return (
    <section className="mx-auto max-w-7xl px-6 py-20">
      <div className="text-center mb-10">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300 mb-3">
          Help
        </p>
        <h2 className="text-3xl font-bold text-white sm:text-4xl">
          Frequently Asked Questions
        </h2>
      </div>

      {/* Tab switcher */}
      <div className="mx-auto mb-8 flex max-w-xs rounded-full border border-white/10 bg-slate-900/60 p-1">
        {(["buyers", "creators"] as TabKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-amber-400 text-slate-950"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {key === "buyers" ? "For Buyers" : "For Creators"}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-slate-950/60 px-8 py-2">
        {tab === "buyers" ? (
          <Accordion items={buyerFaqs} prefix="buyer" />
        ) : (
          <Accordion items={creatorFaqs} prefix="creator" />
        )}
      </div>
    </section>
  );
}

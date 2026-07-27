import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface Web3TooltipProps {
  term: 'XLM' | 'Soroban' | 'Sign Transaction';
  children: React.ReactNode;
}

const explanations: Record<string, string> = {
  XLM: 'XLM (Lumen) is the native cryptocurrency of the Stellar network, used for payments and transaction fees.',
  Soroban: 'Soroban is the smart contract platform on the Stellar network that enables decentralized applications.',
  'Sign Transaction': 'Approving a blockchain action securely using your connected wallet.',
};

export function Web3Tooltip({ term, children }: Web3TooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dashed underline-offset-4 decoration-slate-400">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="max-w-[200px] text-center">{explanations[term]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

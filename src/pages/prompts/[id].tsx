import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PurchaseProgress from '../../components/PurchaseProgress';

// Prompt preview page — shows ONLY public preview metadata. Hidden prompt content is never fetched.

type Creator = {
  username: string;
  avatar: string;
};

type PromptPreview = {
  id: string;
  title: string;
  description: string;
  creator: Creator;
  category: string;
  priceXLM: string;
  salesCount: number;
  createdAt?: string;
  rating?: number;
  reviewsCount?: number;
  publicPreview: string; // teaser only
};

const MOCK_PROMPTS: Record<string, PromptPreview> = {
  'prompt-123': {
    id: 'prompt-123',
    title: 'Advanced Stellar Smart Contract Auditor',
    description:
      'A highly tuned system prompt for finding reentrancy and integer overflow vulnerabilities in Soroban smart contracts.',
    creator: {
      username: 'StellarDev42',
      avatar:
        'https://api.dicebear.com/7.x/bottts/svg?seed=StellarDev42'
    },
    category: 'Development',
    priceXLM: '45.00',
    salesCount: 128,
    createdAt: '2026-01-12',
    rating: 4.9,
    reviewsCount: 54,
    publicPreview:
      'System Prompt (TEASER): Act as a Senior Soroban Auditor. Provide a checklist of areas to verify: transaction atomicity, access controls, integer boundary checks, and potential reentrancy hooks. (Core detection patterns and exact exploit checks are hidden until purchase.)'
  }
};

export default function PromptPreviewPage() {
  const router = useRouter();
  const { id } = router.query as { id?: string };

  const [prompt, setPrompt] = useState<PromptPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    // Simulate fetching ONLY public preview metadata by ID.
    // SECURITY: This simulated fetch returns only publicPreview and metadata. The full prompt payload is not available on this route.
    const fetchPreview = async () => {
      // small delay to mimic network
      await new Promise((r) => setTimeout(r, 350));

      const data = MOCK_PROMPTS[id];
      if (!data) {
        setError('Prompt not found');
        setPrompt(null);
      } else {
        // intentionally only set public fields
        const safe = {
          id: data.id,
          title: data.title,
          description: data.description,
          creator: data.creator,
          category: data.category,
          priceXLM: data.priceXLM,
          salesCount: data.salesCount,
          createdAt: data.createdAt,
          rating: data.rating,
          reviewsCount: data.reviewsCount,
          publicPreview: data.publicPreview
        };
        setPrompt(safe);
      }
      setLoading(false);
    };

    fetchPreview();
  }, [id]);

  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  const handlePurchase = (_promptId: string) => {
    // Open the purchase modal that handles the flow (mocked).
    setShowPurchaseModal(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-100">
        <div className="animate-pulse text-center">
          <div className="h-6 w-72 bg-gray-700 rounded mb-4" />
          <div className="h-4 w-40 bg-gray-700 rounded mx-auto" />
        </div>
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-red-400">
        <div className="p-6 bg-gray-800 rounded">
          <h2 className="text-xl font-semibold">{error ?? 'Prompt not found'}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 py-12 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Hero / Header */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-lg p-6 shadow-lg">
            <div className="flex items-start gap-4">
              <img
                src={prompt.creator.avatar}
                alt={prompt.creator.username}
                className="h-16 w-16 rounded-full ring-2 ring-slate-700 object-cover"
              />
              <div className="flex-1">
                <h1 className="text-2xl font-bold">{prompt.title}</h1>
                <p className="text-sm text-gray-300 mt-1">{prompt.description}</p>

                <div className="mt-3 flex items-center gap-3">
                  <span className="px-3 py-1 bg-gray-800 rounded-full text-xs">{prompt.category}</span>
                  <div className="text-xs text-gray-400">by <strong className="text-gray-100">{prompt.creator.username}</strong></div>
                </div>
              </div>
            </div>
          </div>

          {/* Preview Box */}
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Public Preview</h2>
              <span className="text-xs text-gray-400">Teaser — full content hidden until purchase</span>
            </div>

            <div className="mt-4 bg-gradient-to-b from-gray-900 to-gray-800 p-4 rounded-lg border border-gray-700">
              <pre className="whitespace-pre-wrap text-sm text-gray-200">{prompt.publicPreview}</pre>

              <div className="mt-4 text-xs text-gray-400">
                <p className="mb-2">Example Input Template:</p>
                <code className="block bg-gray-800 px-3 py-2 rounded">{"{"}contract_source: string, network: 'testnet' | 'mainnet', checks: ['reentrancy','overflow']{"}"}</code>
              </div>

              <div className="mt-4 text-sm text-gray-300">
                <p>Sample Output (abstract):</p>
                <ul className="list-disc list-inside mt-2 text-gray-400">
                  <li>Checklist with affected functions</li>
                  <li>Potential severity and exploitability score</li>
                  <li>Suggested remediation steps (high level)</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Additional Info / Notes */}
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-gray-200">About this prompt</h3>
            <p className="text-sm text-gray-400 mt-2">{prompt.description}</p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="text-xs text-gray-400">Creator: <strong className="text-gray-100">{prompt.creator.username}</strong></div>
              <div className="text-xs text-gray-400">Category: <strong className="text-gray-100">{prompt.category}</strong></div>
              <div className="text-xs text-gray-400">Sales: <strong className="text-gray-100">{prompt.salesCount}</strong></div>
              <div className="text-xs text-gray-400">Created: <strong className="text-gray-100">{prompt.createdAt}</strong></div>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="sticky top-24">
            <div className="bg-gradient-to-b from-slate-900 to-slate-800 rounded-lg p-6 border border-gray-800 shadow">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm text-gray-400">Price</div>
                  <div className="text-2xl font-bold text-white">{prompt.priceXLM} XLM</div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div>Rating</div>
                  <div className="text-white font-semibold">{prompt.rating ?? '—'} ★ ({prompt.reviewsCount ?? 0})</div>
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={() => handlePurchase(prompt.id)}
                  className="w-full inline-flex items-center justify-center px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  Purchase Prompt
                </button>
                {showPurchaseModal && (
                  <PurchaseProgress
                    onClose={() => setShowPurchaseModal(false)}
                    onViewUnlocked={() => {
                      setShowPurchaseModal(false);
                      router.push('/profile/MyPurchasesPage');
                    }}
                  />
                )}

                <button
                  onClick={() => navigator.clipboard?.writeText(window.location.href)}
                  className="mt-3 w-full inline-flex items-center justify-center px-3 py-2 bg-gray-800 rounded-md text-sm text-gray-300 hover:bg-gray-700"
                >
                  Share
                </button>
              </div>

              <div className="mt-5 text-xs text-gray-500">
                <div>Sales: {prompt.salesCount}</div>
                <div className="mt-1">Security: Public preview only — core prompt encrypted until purchase.</div>
              </div>
            </div>

            <div className="mt-4 p-4 rounded-lg border border-dashed border-gray-800 text-xs text-gray-400 bg-gray-900">
              <div className="font-semibold text-gray-200 mb-2">Payment</div>
              <p className="text-xs">Purchases occur on Stellar. Wallet integration (Freighter / WebAuth) required to complete transaction. This demo uses a mock purchase handler.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

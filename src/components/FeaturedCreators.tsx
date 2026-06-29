import { Link } from "react-router-dom";
import { ArrowUpRight, Star, Users } from "lucide-react";

interface FeaturedCreator {
  address: string;
  displayName: string;
  specialty: string;
  avatarUrl?: string;
  listingCount: number;
  totalSales: number;
  tagline: string;
}

const FEATURED_CREATORS: FeaturedCreator[] = [
  {
    address: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV2KXPBDQJW",
    displayName: "CodeGuru",
    specialty: "Software Development",
    avatarUrl: "/images/codeguru.png",
    listingCount: 12,
    totalSales: 84,
    tagline: "Architecture reviews, code audits, and system design prompts for engineering teams.",
  },
  {
    address: "GBQNZKAQLWFAZS6RCQZFN2ESOVP4LJZULMZUOWXFTPKZXS6YXMMLDQJ",
    displayName: "MarketMind",
    specialty: "Marketing & Growth",
    avatarUrl: "/browse/campaign.png",
    listingCount: 8,
    totalSales: 61,
    tagline: "Campaign frameworks and multi-channel launch playbooks that convert.",
  },
  {
    address: "GD3DCFB4COYEELFNZPZM7TQXKCMFCNRNTBFHKJ4CWIQNZS7Q3BVQKC2",
    displayName: "FinanceCraft",
    specialty: "Finance & Analysis",
    avatarUrl: "/browse/finance.png",
    listingCount: 6,
    totalSales: 45,
    tagline: "Financial modeling, risk analysis, and investor communication templates.",
  },
];

function CreatorCard({ creator }: { creator: FeaturedCreator }) {
  return (
    <Link
      to={`/sellers/${encodeURIComponent(creator.address)}`}
      className="group flex flex-col rounded-[20px] border border-white/8 bg-white/[0.02] p-5 transition-all duration-300 hover:bg-white/[0.05] hover:-translate-y-1 hover:border-emerald-500/20"
    >
      {/* Avatar + name row */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10 bg-slate-800">
          {creator.avatarUrl ? (
            <img
              src={creator.avatarUrl}
              alt={creator.displayName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold text-slate-300">
              {creator.displayName.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-white group-hover:text-emerald-300 transition-colors truncate">
            {creator.displayName}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {creator.address.slice(0, 8)}…{creator.address.slice(-4)}
          </p>
        </div>
        <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-slate-600 group-hover:text-emerald-400 transition-colors" />
      </div>

      {/* Specialty badge */}
      <span className="mb-3 inline-flex self-start rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
        {creator.specialty}
      </span>

      {/* Tagline */}
      <p className="text-sm leading-6 text-slate-400 flex-1 line-clamp-2">{creator.tagline}</p>

      {/* Stats row */}
      <div className="mt-4 flex items-center gap-4 border-t border-white/5 pt-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3 text-emerald-400" />
          {creator.listingCount} listings
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3 text-cyan-400" />
          {creator.totalSales} sales
        </span>
      </div>
    </Link>
  );
}

export function FeaturedCreators() {
  if (FEATURED_CREATORS.length === 0) {
    return (
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] px-8 py-14 text-center">
          <Users className="mx-auto mb-4 h-10 w-10 text-slate-600" />
          <p className="text-base font-semibold text-white">No featured creators yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Check back soon as the community grows.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-emerald-400 mb-1">
            Community
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Featured Creators</h2>
          <p className="mt-1 text-sm text-slate-400">
            Discover active prompt authors trusted by the marketplace.
          </p>
        </div>
        <Link
          to="/browse"
          className="shrink-0 text-xs font-semibold text-slate-400 hover:text-emerald-300 transition-colors"
        >
          Browse all →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURED_CREATORS.map((creator) => (
          <CreatorCard key={creator.address} creator={creator} />
        ))}
      </div>
    </section>
  );
}

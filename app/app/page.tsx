"use client";

import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { AuctionCard } from "./components/AuctionCard";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";
import { AuctionCardSkeleton } from "./components/Skeleton";
import { useAuctions } from "./lib/auction";
import { deriveAuctionViewState } from "./lib/format";

export default function HomePage() {
  const { auctions, loading, error } = useAuctions();
  const activeAuctions =
    auctions?.filter((entry) => {
      const state = deriveAuctionViewState(entry.account);
      return state === "Active" || state === "BiddingClosed" || state === "SettlementPending";
    }) ?? [];

  return (
    <div>
      <Hero />

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <HowItWorks />
      </section>

      <section id="auctions" className="mx-auto max-w-7xl px-6 pb-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500">
              Marketplace
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">
              Active Auctions
            </h2>
          </div>

          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
          >
            <LockKeyhole size={14} />
            Create Auction
            <ArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <AuctionCardSkeleton key={index} />
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <div className="umbra-panel rounded-3xl p-6 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {!loading && !error && activeAuctions.length === 0 ? (
          <div className="umbra-panel rounded-3xl p-8 text-center">
            <p className="text-lg font-semibold text-white">No active auctions yet</p>
            <p className="mt-2 text-sm text-zinc-400">
              Create the first sealed-bid auction and escrow an NFT to get started.
            </p>
          </div>
        ) : null}

        {!loading && !error && activeAuctions.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {activeAuctions.map((auction) => (
              <AuctionCard key={auction.publicKey.toBase58()} auction={auction} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

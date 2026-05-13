"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Clock3, Lock, Users } from "lucide-react";
import { fetchNftMetadata, placeholderImage } from "../lib/metadata";
import { CountdownTimer } from "./CountdownTimer";
import { deriveAuctionViewState, formatSol, stateBadgeClass, truncateAddress } from "../lib/format";
import type { AuctionWithKey } from "../lib/auction";

export function AuctionCard({ auction }: { auction: AuctionWithKey }) {
  const { connection } = useConnection();
  const [name, setName] = useState(`NFT ${auction.account.nftMint.toBase58().slice(0, 4)}`);
  const [image, setImage] = useState(placeholderImage(auction.account.nftMint.toBase58()));
  const state = deriveAuctionViewState(auction.account);

  useEffect(() => {
    let cancelled = false;

    fetchNftMetadata(connection, auction.account.nftMint as PublicKey).then((metadata) => {
      if (cancelled) return;
      setName(metadata.name || name);
      if (metadata.image) {
        setImage(metadata.image);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [auction.account.nftMint, connection, name]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <Link
        href={`/auction/${auction.publicKey.toBase58()}`}
        className="umbra-panel umbra-card-hover block overflow-hidden rounded-[28px]"
      >
        <div className="relative aspect-square overflow-hidden">
          <Image
            src={image}
            alt={name}
            fill
            unoptimized
            sizes="(max-width: 1024px) 100vw, 33vw"
            className="object-cover transition duration-500 hover:scale-[1.03]"
          />
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" />
          <div className="absolute left-4 top-4 inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md">
            <span className={stateBadgeClass(state)}>{state}</span>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <h3 className="line-clamp-1 text-lg font-semibold text-white">{name}</h3>
            <p className="mt-1 text-xs font-mono text-zinc-500">
              Seller {truncateAddress(auction.account.seller as PublicKey)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm text-zinc-400">
            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2 text-zinc-500">
                <Users size={13} />
                Bids
              </div>
              <div className="mt-2 text-base font-semibold text-white">
                {auction.account.bidCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2 text-zinc-500">
                <Clock3 size={13} />
                {state === "Settled" ? "Winning bid" : "Time left"}
              </div>
              <div className="mt-2 text-base font-semibold text-white">
                {state === "Settled" ? (
                  formatSol(auction.account.winningBid, 2)
                ) : (
                  <CountdownTimer endTs={auction.account.endTs.toNumber()} />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="inline-flex items-center gap-2 text-zinc-500">
              <Lock size={14} className="text-violet-400" />
              Losing bids stay sealed
            </div>
            <span className="font-medium text-white">View</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

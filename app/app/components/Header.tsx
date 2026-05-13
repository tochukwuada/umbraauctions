"use client";

import Link from "next/link";
import { EyeOff, Plus } from "lucide-react";
import { ConnectWalletButton } from "./ConnectWalletButton";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0a0a0b]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,_#f59e0b,_#dc2626)] shadow-[0_12px_32px_rgba(245,158,11,0.24)]">
            <EyeOff size={18} className="text-white" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Umbra</div>
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">
              Sealed-Bid NFT Auctions
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
          <Link href="/" className="hover:text-white">
            Browse
          </Link>
          <Link href="/create" className="hover:text-white">
            Create
          </Link>
          <a
            href="https://rtg.arcium.com/rtg?category=developers"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            RTG
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/create"
            className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10 sm:inline-flex"
          >
            <Plus size={14} /> Create Auction
          </Link>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}

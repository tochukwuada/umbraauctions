import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 pb-16 pt-20 sm:pt-28">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
          <ShieldCheck size={12} className="text-accent" />
          Powered by Arcium MPC on Solana
        </div>

        <div className="mt-8 max-w-4xl">
          <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight text-white sm:text-6xl md:text-7xl">
            Sealed-bid NFT auctions
            <span className="block bg-[linear-gradient(135deg,_#f59e0b,_#dc2626)] bg-clip-text text-transparent">
              on Solana.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
            Your bid is encrypted client-side, kept secret by Arcium MPC, and
            revealed only at settlement, and only to set the winning price.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#auctions"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,158,11,0.22)] hover:bg-accent-hover"
          >
            Browse Auctions <ArrowRight size={16} />
          </a>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
          >
            <LockKeyhole size={14} /> Create Auction
          </Link>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0d0d10]/70">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-3">
        <div>
          <p className="text-sm font-semibold text-white">Umbra</p>
          <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-500">
            Sealed-bid NFT auctions on Solana, powered by Arcium MPC.
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Product</p>
          <div className="mt-3 space-y-2 text-sm text-zinc-500">
            <Link href="/" className="block hover:text-white">
              Browse auctions
            </Link>
            <Link href="/create" className="block hover:text-white">
              Create auction
            </Link>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Links</p>
          <div className="mt-3 space-y-2 text-sm text-zinc-500">
            <a
              href="https://docs.arcium.com"
              target="_blank"
              rel="noreferrer"
              className="block hover:text-white"
            >
              Arcium docs
            </a>
            <a
              href="https://rtg.arcium.com/rtg?category=developers"
              target="_blank"
              rel="noreferrer"
              className="block hover:text-white"
            >
              Blind Auctions RTG
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

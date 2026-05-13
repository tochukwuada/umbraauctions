"use client";

/**
 * Privacy note:
 * Auction creation now generates one valid encrypted inactive bid sentinel and
 * stores it on-chain with the auction. Settlement reuses that sentinel for
 * unused MPC slots so auctions work with fewer than 8 bidders without leaking
 * any bidder data or relying on invalid zero ciphertext padding.
 */

import Image from "next/image";
import { useEffect, useState } from "react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchNftMetadata, placeholderImage, type NftMetadata } from "../lib/metadata";
import { encryptBid, getMXEPublicKeyWithRetry } from "../lib/encryption";
import { auctionPda, solEscrowPda } from "../lib/pdas";
import { useUmbraProgram } from "../lib/program";

function defaultStart() {
  return new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);
}

function defaultEnd() {
  return new Date(Date.now() + 29 * 60 * 60_000).toISOString().slice(0, 16);
}

export default function CreateAuctionPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const router = useRouter();
  const program = useUmbraProgram();

  const [mintAddress, setMintAddress] = useState("");
  const [auctionId, setAuctionId] = useState(String(Math.floor(Date.now() / 1000)));
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [metadata, setMetadata] = useState<NftMetadata | null>(null);
  const [ownsNft, setOwnsNft] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    if (!mintAddress) {
      setMetadata(null);
      setOwnsNft(null);
      setMintError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const mint = new PublicKey(mintAddress);
        const fetchedMetadata = await fetchNftMetadata(connection, mint);
        if (cancelled) return;
        setMetadata(fetchedMetadata);
        setMintError(null);

        if (wallet.publicKey) {
          const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
          const accountInfo = await connection.getTokenAccountBalance(ata).catch(() => null);
          if (!cancelled) {
            setOwnsNft(accountInfo?.value.uiAmount !== null && (accountInfo?.value.uiAmount ?? 0) >= 1);
          }
        }
      } catch {
        if (!cancelled) {
          setMetadata(null);
          setOwnsNft(null);
          setMintError("Enter a valid NFT mint address.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, mintAddress, wallet.publicKey]);

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const timeError =
    Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
      ? "Choose valid start and end times."
      : endDate <= startDate
        ? "End time must be after the start time."
        : null;

  const canSubmit =
    !!wallet.publicKey &&
    !!wallet.signTransaction &&
    !!wallet.signAllTransactions &&
    !!metadata &&
    ownsNft === true &&
    !mintError &&
    !timeError &&
    !!auctionId;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions || !canSubmit) {
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Creating auction...");

    try {
      const mint = new PublicKey(mintAddress);
      const auctionKey = auctionPda(wallet.publicKey, BigInt(auctionId));
      const mxePublicKey = await getMXEPublicKeyWithRetry(
        program.provider as AnchorProvider,
        program.programId
      );
      const sentinel = encryptBid(0n, mxePublicKey, false);
      toast.loading("Escrowing NFT...", { id: toastId });

      await program.methods
        .createAuction(
          new BN(auctionId),
          new BN(Math.floor(startDate.getTime() / 1000)),
          new BN(Math.floor(endDate.getTime() / 1000)),
          sentinel.ciphertext0,
          sentinel.ciphertext1,
          sentinel.pubKey,
          sentinel.nonce
        )
        .accountsPartial({
          seller: wallet.publicKey,
          nftMint: mint,
          sellerNftAta: getAssociatedTokenAddressSync(mint, wallet.publicKey),
          auction: auctionKey,
          nftEscrowAta: getAssociatedTokenAddressSync(mint, auctionKey, true),
          solEscrow: solEscrowPda(auctionKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      toast.success("Auction created.", { id: toastId });
      router.push(`/auction/${auctionKey.toBase58()}`);
    } catch (error) {
      console.error(error);
      toast.error("Auction creation failed.", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500">
          Create
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-white">
          Create Auction & Escrow NFT
        </h1>
        <p className="mt-3 text-sm leading-7 text-zinc-400">
          Paste a classic NFT mint you own, choose the bidding window, and Umbra will escrow the asset into a sealed-bid auction.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <form onSubmit={handleSubmit} className="umbra-panel rounded-[32px] p-6 sm:p-8">
          <div className="space-y-5">
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                NFT mint address
              </label>
              <input
                value={mintAddress}
                onChange={(event) => setMintAddress(event.target.value.trim())}
                placeholder="Enter a classic NFT mint"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-accent/60"
              />
              {mintError ? <p className="mt-2 text-xs text-red-300">{mintError}</p> : null}
              {ownsNft === false ? (
                <p className="mt-2 text-xs text-red-300">
                  The connected wallet does not own this mint.
                </p>
              ) : null}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                  Auction ID
                </label>
                <input
                  type="number"
                  value={auctionId}
                  onChange={(event) => setAuctionId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-accent/60"
                />
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
                Use any seller-specific unique number. The default is the current Unix timestamp.
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                  Start time
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-accent/60"
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                  End time
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-accent/60"
                />
              </div>
            </div>

            {timeError ? <p className="text-xs text-red-300">{timeError}</p> : null}

            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(245,158,11,0.22)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <EyeOff size={15} />
                  Create Auction & Escrow NFT
                </>
              )}
            </button>
          </div>
        </form>

        <div className="umbra-panel rounded-[32px] p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500">
            Live Preview
          </p>
          <div className="mt-5 overflow-hidden rounded-[28px] border border-white/6 bg-black/20">
            <div className="relative aspect-square">
              <Image
                src={metadata?.image || placeholderImage(mintAddress || "umbra")}
                alt={metadata?.name || "NFT preview"}
                fill
                unoptimized
                className="object-cover"
              />
            </div>
            <div className="space-y-4 p-5">
              <div>
                <div className="text-lg font-semibold text-white">
                  {metadata?.name || "Your NFT"}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  {metadata?.symbol || "Awaiting metadata"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm text-zinc-400">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="text-zinc-500">Starts</div>
                  <div className="mt-1 font-medium text-white">
                    {startTime ? new Date(startTime).toLocaleString() : "--"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="text-zinc-500">Ends</div>
                  <div className="mt-1 font-medium text-white">
                    {endTime ? new Date(endTime).toLocaleString() : "--"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
                Bidders will see public collateral only. The actual bid stays encrypted unless the bidder wins.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import BN from "bn.js";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { bidderRecordPda, solEscrowPda } from "../lib/pdas";
import { useUmbraProgram } from "../lib/program";
import { encryptBid, getMXEPublicKeyWithRetry } from "../lib/encryption";
import { PROGRAM_ID } from "../lib/constants";

export function BidForm({
  auctionKey,
  onSubmitted,
}: {
  auctionKey: PublicKey;
  onSubmitted: () => void;
}) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const program = useUmbraProgram();

  const [maxCollateral, setMaxCollateral] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [sealed, setSealed] = useState(false);

  const maxValue = Number(maxCollateral);
  const bidValue = Number(bidAmount);
  const maxError =
    maxCollateral.length > 0 && !(maxValue > 0)
      ? "Max collateral must be greater than zero."
      : null;
  const bidError =
    bidAmount.length > 0 && !(bidValue > 0)
      ? "Bid must be greater than zero."
      : bidValue > maxValue
        ? "Bid must be less than or equal to max collateral."
        : null;

  const isValid =
    !!wallet.publicKey &&
    !Number.isNaN(maxValue) &&
    !Number.isNaN(bidValue) &&
    maxValue > 0 &&
    bidValue > 0 &&
    bidValue <= maxValue;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions || !isValid) {
      return;
    }

    setBusy(true);
    setSealed(true);
    const toastId = toast.loading("Encrypting bid...");

    try {
      const provider = new AnchorProvider(
        connection,
        {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions,
        } as never,
        { commitment: "confirmed" }
      );

      const mxePublicKey = await getMXEPublicKeyWithRetry(provider, PROGRAM_ID);
      toast.loading("Locking collateral...", { id: toastId });

      const encrypted = encryptBid(
        BigInt(Math.round(bidValue * LAMPORTS_PER_SOL)),
        mxePublicKey
      );

      toast.loading("Submitting sealed bid...", { id: toastId });
      await program.methods
        .submitBid(
          new BN(Math.round(maxValue * LAMPORTS_PER_SOL)),
          encrypted.ciphertext0,
          encrypted.ciphertext1,
          encrypted.pubKey,
          encrypted.nonce
        )
        .accountsPartial({
          bidder: wallet.publicKey,
          auction: auctionKey,
          bidderRecord: bidderRecordPda(auctionKey, wallet.publicKey),
          solEscrow: solEscrowPda(auctionKey),
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      toast.success("Sealed bid submitted.", { id: toastId });
      setBidAmount("");
      setMaxCollateral("");
      onSubmitted();
    } catch (error) {
      console.error(error);
      toast.error("Bid submission failed.", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
      setTimeout(() => setSealed(false), 600);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Max collateral (SOL)
        </label>
        <input
          type="number"
          min="0"
          step="0.0001"
          value={maxCollateral}
          onChange={(event) => setMaxCollateral(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-accent/60"
          placeholder="6.00"
        />
        {maxError ? <p className="mt-2 text-xs text-red-300">{maxError}</p> : null}
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Your sealed bid (SOL)
        </label>
        <div className="mt-2 flex h-12 items-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white">
          {sealed ? "••••••••" : null}
          {!sealed ? (
            <input
              type="number"
              min="0"
              step="0.0001"
              value={bidAmount}
              onChange={(event) => setBidAmount(event.target.value)}
              className="w-full bg-transparent outline-none"
              placeholder="5.00"
            />
          ) : null}
        </div>
        {bidError ? <p className="mt-2 text-xs text-red-300">{bidError}</p> : null}
      </div>

      <p className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-zinc-400">
        Your max collateral is the public upper bound, visible on-chain. Your actual bid is encrypted and revealed only if you win. Excess collateral is refunded after settlement.
      </p>

      <button
        type="submit"
        disabled={!isValid || busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(245,158,11,0.22)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Sealing Bid...
          </>
        ) : (
          <>
            <Lock size={14} />
            Submit Sealed Bid
            <Sparkles size={14} />
          </>
        )}
      </button>
    </form>
  );
}

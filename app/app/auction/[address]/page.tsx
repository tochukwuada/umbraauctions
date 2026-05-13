"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Crown,
  Loader2,
  Lock,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { BidForm } from "../../components/BidForm";
import { CountdownTimer } from "../../components/CountdownTimer";
import { HowItWorks } from "../../components/HowItWorks";
import { Skeleton } from "../../components/Skeleton";
import {
  useAuction,
  useBidderRecords,
  useMyBidderRecord,
  type BidderRecordWithKey,
} from "../../lib/auction";
import { arciumQueueAccounts } from "../../lib/arcium";
import {
  deriveAuctionViewState,
  formatSol,
  stateBadgeClass,
  truncateAddress,
} from "../../lib/format";
import { fetchNftMetadata, placeholderImage, type NftMetadata } from "../../lib/metadata";
import { bidderRecordPda, solEscrowPda } from "../../lib/pdas";
import { useUmbraProgram } from "../../lib/program";

export default function AuctionDetailPage({
  params,
}: {
  params: { address: string };
}) {
  let auctionKey: PublicKey | null = null;

  try {
    auctionKey = new PublicKey(params.address);
  } catch {
    auctionKey = null;
  }

  if (!auctionKey) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <AlertTriangle className="mx-auto text-red-400" size={28} />
        <h1 className="mt-4 text-2xl font-semibold text-white">Invalid auction address</h1>
      </div>
    );
  }

  return <AuctionDetail auctionKey={auctionKey} />;
}

function AuctionDetail({ auctionKey }: { auctionKey: PublicKey }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const program = useUmbraProgram();
  const { auction, loading, error } = useAuction(auctionKey);
  const { records, refresh: refreshRecords } = useBidderRecords(auctionKey);
  const { record: myRecord, refresh: refreshMyRecord } = useMyBidderRecord(
    auctionKey,
    wallet.publicKey ?? null
  );
  const [metadata, setMetadata] = useState<NftMetadata | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!auction) return;
    fetchNftMetadata(connection, auction.nftMint as PublicKey).then(setMetadata);
  }, [auction, connection]);

  const viewState = auction ? deriveAuctionViewState(auction) : null;
  const winnerRecord = useMemo(() => {
    if (!auction || !records) return null;
    return (
      records.find((entry) => entry.account.bidderIndex === auction.winnerIndex) ?? null
    );
  }, [auction, records]);

  const isMyWinningRecord =
    !!wallet.publicKey &&
    !!winnerRecord &&
    wallet.publicKey.equals(winnerRecord.account.bidder as PublicKey);
  const canRefundAsLoser =
    !!auction &&
    !!myRecord &&
    !myRecord.refunded &&
    (viewState === "Settled" || viewState === "EmergencyClosed") &&
    (!auction.hasValidWinner || myRecord.bidderIndex !== auction.winnerIndex);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12">
        <Skeleton className="h-4 w-28" />
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <Skeleton className="aspect-square rounded-[32px]" />
          <div className="space-y-6">
            <Skeleton className="h-48 rounded-[32px]" />
            <Skeleton className="h-72 rounded-[32px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!auction || error || !viewState) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <AlertTriangle className="mx-auto text-red-400" size={28} />
        <h1 className="mt-4 text-2xl font-semibold text-white">Auction unavailable</h1>
        <p className="mt-2 text-zinc-400">
          {error || "This auction could not be loaded."}
        </p>
      </div>
    );
  }

  const loadedAuction = auction;

  async function queueSettlement() {
    if (!wallet.publicKey || !records) return;

    setBusyAction("queue");
    const toastId = toast.loading("Queueing settlement on Arcium MPC...");

    try {
      const computationOffset = new BN(Date.now().toString());
      await program.methods
        .queueFindWinner(computationOffset)
        .accountsPartial({
          payer: wallet.publicKey,
          auction: auctionKey,
          ...arciumQueueAccounts(program.programId, computationOffset, "find_winner"),
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(
          records.map((record) => ({
            pubkey: record.publicKey,
            isSigner: false,
            isWritable: false,
          }))
        )
        .rpc({ commitment: "confirmed" });

      toast.success("Settlement queued.", { id: toastId });
      refreshRecords();
    } catch (error) {
      console.error(error);
      toast.error("Failed to queue settlement.", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function settleAuction() {
    if (!wallet.publicKey || !winnerRecord) return;

    setBusyAction("settle");
    const toastId = toast.loading("Finalizing NFT delivery...");

    try {
      await program.methods
        .settleAuction()
        .accountsPartial({
          caller: wallet.publicKey,
          auction: auctionKey,
          winnerRecord: bidderRecordPda(auctionKey, winnerRecord.account.bidder as PublicKey),
          winner: winnerRecord.account.bidder as PublicKey,
          seller: loadedAuction.seller as PublicKey,
          nftMint: loadedAuction.nftMint as PublicKey,
          nftEscrowAta: loadedAuction.nftEscrow as PublicKey,
          winnerNftAta: getAssociatedTokenAddressSync(
            loadedAuction.nftMint as PublicKey,
            winnerRecord.account.bidder as PublicKey
          ),
          solEscrow: solEscrowPda(auctionKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      toast.success("Auction settled.", { id: toastId });
      refreshRecords();
      refreshMyRecord();
    } catch (error) {
      console.error(error);
      toast.error("Settlement failed.", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function refundMyCollateral() {
    if (!wallet.publicKey || !myRecord) return;

    setBusyAction("refund");
    const toastId = toast.loading("Refunding collateral...");

    try {
      await program.methods
        .refundLoser()
        .accountsPartial({
          caller: wallet.publicKey,
          auction: auctionKey,
          loserRecord: bidderRecordPda(auctionKey, wallet.publicKey),
          loser: wallet.publicKey,
          solEscrow: solEscrowPda(auctionKey),
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      toast.success("Collateral refunded.", { id: toastId });
      refreshRecords();
      refreshMyRecord();
    } catch (error) {
      console.error(error);
      toast.error("Refund failed.", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function reclaimNft() {
    if (!wallet.publicKey) return;

    setBusyAction("reclaim");
    const toastId = toast.loading("Reclaiming NFT...");

    try {
      await program.methods
        .emergencyReclaimNft()
        .accountsPartial({
          seller: wallet.publicKey,
          auction: auctionKey,
          nftMint: loadedAuction.nftMint as PublicKey,
          sellerNftAta: getAssociatedTokenAddressSync(
            loadedAuction.nftMint as PublicKey,
            wallet.publicKey
          ),
          nftEscrowAta: loadedAuction.nftEscrow as PublicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      toast.success("NFT reclaimed.", { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error("Reclaim failed.", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft size={14} />
        Back to auctions
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.02fr_0.98fr]">
        <div>
          <div className="umbra-panel overflow-hidden rounded-[32px]">
            <div className="relative aspect-square">
              <Image
                src={metadata?.image || placeholderImage(loadedAuction.nftMint.toBase58())}
                alt={metadata?.name || "NFT"}
                fill
                unoptimized
                className="object-cover"
              />
              <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" />
            </div>
          </div>

          <div className="mt-5 rounded-[28px] border border-white/6 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Asset
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
              {metadata?.name || `NFT ${loadedAuction.nftMint.toBase58().slice(0, 4)}`}
            </h1>
            <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Seller" value={truncateAddress(loadedAuction.seller as PublicKey)} mono />
              <Detail label="Mint" value={truncateAddress(loadedAuction.nftMint as PublicKey)} mono />
              <Detail label="Starts" value={new Date(loadedAuction.startTs.toNumber() * 1000).toLocaleString()} />
              <Detail label="Ends" value={new Date(loadedAuction.endTs.toNumber() * 1000).toLocaleString()} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <StatusCard
            viewState={viewState}
            auction={loadedAuction}
            winnerRecord={winnerRecord}
            onQueue={queueSettlement}
            onSettle={settleAuction}
            onRefund={refundMyCollateral}
            onReclaim={reclaimNft}
            isSeller={!!wallet.publicKey && wallet.publicKey.equals(loadedAuction.seller as PublicKey)}
            canRefundAsLoser={canRefundAsLoser}
            winnerSettled={!!winnerRecord?.account.refunded}
            busyAction={busyAction}
          />

          {viewState === "Active" && !myRecord ? (
            <div className="umbra-panel rounded-[32px] p-6">
              <div className="mb-5">
                <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Submit Bid
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Place a sealed bid
                </h2>
              </div>
              <BidForm
                auctionKey={auctionKey}
                onSubmitted={() => {
                  refreshRecords();
                  refreshMyRecord();
                }}
              />
            </div>
          ) : null}

          {viewState === "Active" && myRecord ? (
            <div className="umbra-panel rounded-[32px] p-6">
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Your Bid
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">Encrypted ✦</div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Detail label="Max collateral locked" value={formatSol(myRecord.maxCollateral, 2)} />
                <Detail label="Position" value={`#${myRecord.bidderIndex}`} mono />
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-400">
                Your bid will be revealed only if you win, and only as the final settlement price.
              </p>
            </div>
          ) : null}

          <BiddersCard
            records={records ?? []}
            currentWallet={wallet.publicKey ?? null}
            winningBid={loadedAuction.winningBid}
            winnerIndex={loadedAuction.winnerIndex}
            hasValidWinner={loadedAuction.hasValidWinner}
            viewState={viewState}
          />

          <HowItWorks />
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  viewState,
  auction,
  winnerRecord,
  onQueue,
  onSettle,
  onRefund,
  onReclaim,
  isSeller,
  canRefundAsLoser,
  winnerSettled,
  busyAction,
}: {
  viewState: ReturnType<typeof deriveAuctionViewState>;
  auction: NonNullable<ReturnType<typeof useAuction>["auction"]>;
  winnerRecord: BidderRecordWithKey | null;
  onQueue: () => Promise<void>;
  onSettle: () => Promise<void>;
  onRefund: () => Promise<void>;
  onReclaim: () => Promise<void>;
  isSeller: boolean;
  canRefundAsLoser: boolean;
  winnerSettled: boolean;
  busyAction: string | null;
}) {
  const statusText = (() => {
    if (viewState === "Active") {
      return (
        <div>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Clock3 size={14} />
            Bidding ends in <CountdownTimer endTs={auction.endTs.toNumber()} className="font-medium text-white" />
          </div>
        </div>
      );
    }

    if (viewState === "BiddingClosed") {
      return <p className="text-sm leading-6 text-zinc-300">Bidding ended. Settlement is ready to queue on Arcium MPC.</p>;
    }

    if (viewState === "SettlementPending") {
      return <p className="text-sm leading-6 text-zinc-300">Computing the winner on Arcium MPC...</p>;
    }

    if (viewState === "Settled" && winnerRecord) {
      return (
        <p className="text-sm leading-6 text-zinc-300">
          Winner: <span className="font-mono text-white">{truncateAddress(winnerRecord.account.bidder as PublicKey)}</span>
          {" • "}
          Winning bid: <span className="font-semibold text-white">{formatSol(auction.winningBid, 2)}</span>
        </p>
      );
    }

    if (viewState === "EmergencyClosed") {
      return <p className="text-sm leading-6 text-zinc-300">Auction closed. No valid winner was produced.</p>;
    }

    if (viewState === "SettlementFailed") {
      return <p className="text-sm leading-6 text-zinc-300">Settlement failed. Retry later or use the emergency paths after the timeout.</p>;
    }

    return <p className="text-sm leading-6 text-zinc-300">This auction is no longer active.</p>;
  })();

  return (
    <div className="umbra-panel rounded-[32px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${stateBadgeClass(viewState)}`}>
            {viewState}
          </div>
          <div className="mt-4">{statusText}</div>
        </div>

        {viewState === "SettlementPending" ? (
          <Loader2 size={20} className="animate-spin text-violet-300" />
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {viewState === "BiddingClosed" ? (
          <ActionButton onClick={onQueue} busy={busyAction === "queue"}>
            <RefreshCcw size={14} />
            Settle Auction
          </ActionButton>
        ) : null}

        {viewState === "Settled" && auction.hasValidWinner && !winnerSettled ? (
          <ActionButton onClick={onSettle} busy={busyAction === "settle"}>
            <Crown size={14} />
            Finalize Delivery
          </ActionButton>
        ) : null}

        {canRefundAsLoser ? (
          <ActionButton onClick={onRefund} busy={busyAction === "refund"} muted>
            <CheckCircle2 size={14} />
            Refund My Collateral
          </ActionButton>
        ) : null}

        {viewState === "EmergencyClosed" && isSeller ? (
          <ActionButton onClick={onReclaim} busy={busyAction === "reclaim"} muted>
            <Lock size={14} />
            Reclaim NFT
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

function BiddersCard({
  records,
  currentWallet,
  winningBid,
  winnerIndex,
  hasValidWinner,
  viewState,
}: {
  records: BidderRecordWithKey[];
  currentWallet: PublicKey | null;
  winningBid: BN;
  winnerIndex: number;
  hasValidWinner: boolean;
  viewState: ReturnType<typeof deriveAuctionViewState>;
}) {
  return (
    <div className="umbra-panel rounded-[32px] p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Bidders</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Bidders ({records.length})</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-200">
          <Lock size={12} />
          Sealed
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {records.length === 0 ? (
          <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 text-sm text-zinc-400">
            No bids yet.
          </div>
        ) : null}

        {records.map((record) => {
          const isCurrentUser =
            !!currentWallet &&
            currentWallet.equals(record.account.bidder as PublicKey);
          const isWinner =
            hasValidWinner && record.account.bidderIndex === winnerIndex;

          return (
            <div
              key={record.publicKey.toBase58()}
              className={`rounded-2xl border bg-white/[0.03] p-4 ${
                isCurrentUser
                  ? "border-amber-400/60 ring-2 ring-amber-400/20"
                  : "border-white/6"
              } ${viewState === "Settled" && !isWinner ? "opacity-75" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-lg font-semibold text-white">
                    #{record.account.bidderIndex}
                  </div>
                  <div className="text-xs text-zinc-500">Sealed bid</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-white">
                    Max {formatSol(record.account.maxCollateral, 2)}
                  </div>
                  <div className="text-xs text-zinc-500">Collateral locked</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {isCurrentUser ? (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-200">
                    You
                  </span>
                ) : null}
                {viewState === "Settled" && isWinner ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200">
                    Winner — paid {formatSol(winningBid, 2)}
                  </span>
                ) : null}
                {viewState === "Settled" && !isWinner ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400">
                    Sealed forever
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  muted,
}: {
  children: React.ReactNode;
  onClick: () => Promise<void>;
  busy: boolean;
  muted?: boolean;
}) {
  return (
    <button
      onClick={() => void onClick()}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium ${
        muted
          ? "border border-white/10 bg-white/5 text-white hover:bg-white/10"
          : "bg-accent text-white hover:bg-accent-hover"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className={`mt-2 text-sm text-white ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

import BN from "bn.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import type { AuctionAccount } from "./auction";

export function truncateAddress(addr: PublicKey | string, size = 4): string {
  const value = typeof addr === "string" ? addr : addr.toBase58();
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

export function lamportsToSol(lamports: BN | number | bigint): number {
  if (typeof lamports === "number") return lamports / LAMPORTS_PER_SOL;
  if (typeof lamports === "bigint") return Number(lamports) / LAMPORTS_PER_SOL;
  return lamports.toNumber() / LAMPORTS_PER_SOL;
}

export function formatSol(lamports: BN | number | bigint, decimals = 2): string {
  return `${lamportsToSol(lamports).toFixed(decimals)} SOL`;
}

export function solToLamports(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL));
}

export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Ended";

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export type AuctionViewState =
  | "Active"
  | "BiddingClosed"
  | "SettlementPending"
  | "Settled"
  | "SettlementFailed"
  | "Cancelled"
  | "EmergencyClosed";

export function deriveAuctionViewState(
  auction: AuctionAccount,
  nowSeconds = Math.floor(Date.now() / 1000)
): AuctionViewState {
  const raw = auction.state as Record<string, unknown>;

  if ("cancelled" in raw) return "Cancelled";
  if ("settlementPending" in raw) return "SettlementPending";
  if ("settlementFailed" in raw) return "SettlementFailed";
  if ("emergencyClosed" in raw) return "EmergencyClosed";
  if ("settled" in raw && !auction.hasValidWinner) return "EmergencyClosed";
  if ("settled" in raw) return "Settled";
  if ("active" in raw && nowSeconds >= auction.endTs.toNumber()) {
    return "BiddingClosed";
  }
  if ("biddingClosed" in raw) return "BiddingClosed";
  return "Active";
}

export function stateBadgeClass(state: AuctionViewState): string {
  switch (state) {
    case "Active":
      return "border-emerald-500/30 bg-emerald-500/12 text-emerald-300";
    case "BiddingClosed":
      return "border-amber-500/30 bg-amber-500/12 text-amber-300";
    case "SettlementPending":
      return "border-violet-500/30 bg-violet-500/12 text-violet-300";
    case "Settled":
      return "border-cyan-500/30 bg-cyan-500/12 text-cyan-200";
    case "SettlementFailed":
      return "border-red-500/30 bg-red-500/12 text-red-300";
    case "Cancelled":
      return "border-zinc-500/30 bg-zinc-500/12 text-zinc-300";
    case "EmergencyClosed":
      return "border-orange-500/30 bg-orange-500/12 text-orange-300";
  }
}

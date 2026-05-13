import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "8kUjxXEnqKNC6ny2tRuJGQMyPqefF6SyGyhbvQWzyaDE"
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export const ARCIUM_CLUSTER_OFFSET = Number(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET ?? 456
);

export const AUCTION_SEED = Buffer.from("auction");
export const BIDDER_SEED = Buffer.from("bidder");
export const SOL_ESCROW_SEED = Buffer.from("sol_escrow");

export const MAX_BIDDERS = 8;

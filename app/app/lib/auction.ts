"use client";

import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { useReadOnlyProgram, useUmbraProgram } from "./program";
import { bidderRecordPda } from "./pdas";
import type { Umbraauctions } from "../../idl/umbraauctions";

export type AuctionAccount = Awaited<
  ReturnType<Program<Umbraauctions>["account"]["auction"]["fetch"]>
>;
export type BidderRecordAccount = Awaited<
  ReturnType<Program<Umbraauctions>["account"]["bidderRecord"]["fetch"]>
>;

export type AuctionWithKey = {
  publicKey: PublicKey;
  account: AuctionAccount;
};

export type BidderRecordWithKey = {
  publicKey: PublicKey;
  account: BidderRecordAccount;
};

export function useAuctions() {
  const program = useReadOnlyProgram();
  const [auctions, setAuctions] = useState<AuctionWithKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const accounts = await program.account.auction.all();
        accounts.sort((a, b) => b.account.startTs.toNumber() - a.account.startTs.toNumber());

        if (!cancelled) {
          setAuctions(
            accounts.map((entry) => ({
              publicKey: entry.publicKey,
              account: entry.account,
            }))
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program]);

  return { auctions, loading, error };
}

export function useAuction(address: PublicKey | null) {
  const { connection } = useConnection();
  const program = useUmbraProgram();
  const [auction, setAuction] = useState<AuctionAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subId = useRef<number | null>(null);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const account = await program.account.auction.fetch(address);
        if (!cancelled) {
          setAuction(account);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    subId.current = connection.onAccountChange(
      address,
      (info) => {
        try {
          const decoded = program.coder.accounts.decode<AuctionAccount>(
            "auction",
            info.data
          );
          setAuction(decoded);
        } catch {
          // Ignore transient decode failures while the account is updating.
        }
      },
      "confirmed"
    );

    return () => {
      cancelled = true;
      if (subId.current !== null) {
        connection.removeAccountChangeListener(subId.current);
        subId.current = null;
      }
    };
  }, [address?.toBase58(), connection, program]); // eslint-disable-line react-hooks/exhaustive-deps

  return { auction, loading, error };
}

export function useBidderRecords(auction: PublicKey | null) {
  const program = useReadOnlyProgram();
  const [records, setRecords] = useState<BidderRecordWithKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!auction) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const accounts = await program.account.bidderRecord.all([
          {
            memcmp: {
              offset: 8,
              bytes: auction.toBase58(),
            },
          },
        ]);

        accounts.sort((a, b) => a.account.bidderIndex - b.account.bidderIndex);

        if (!cancelled) {
          setRecords(
            accounts.map((entry) => ({
              publicKey: entry.publicKey,
              account: entry.account,
            }))
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auction?.toBase58(), program, refreshKey]);

  return {
    records,
    loading,
    error,
    refresh: () => setRefreshKey((current) => current + 1),
  };
}

export function useMyBidderRecord(
  auction: PublicKey | null,
  wallet: PublicKey | null
) {
  const program = useReadOnlyProgram();
  const [record, setRecord] = useState<BidderRecordAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!auction || !wallet) {
      setRecord(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const account = await program.account.bidderRecord.fetchNullable(
          bidderRecordPda(auction, wallet)
        );

        if (!cancelled) {
          setRecord(account);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRecord(null);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auction?.toBase58(), wallet?.toBase58(), program, refreshKey]);

  return {
    record,
    loading,
    refresh: () => setRefreshKey((current) => current + 1),
  };
}

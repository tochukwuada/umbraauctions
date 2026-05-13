"use client";

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import idl from "../../idl/umbraauctions.json";
import type { Umbraauctions } from "../../idl/umbraauctions";

function createReadOnlyProvider(connection: AnchorProvider["connection"]) {
  const dummyWallet = {
    publicKey: undefined as never,
    signTransaction: async () => {
      throw new Error("Read-only provider cannot sign transactions");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only provider cannot sign transactions");
    },
  };

  return new AnchorProvider(connection, dummyWallet as never, {
    commitment: "confirmed",
  });
}

export function useUmbraProgram(): Program<Umbraauctions> {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    const provider = wallet
      ? new AnchorProvider(connection, wallet, { commitment: "confirmed" })
      : createReadOnlyProvider(connection);
    return new Program<Umbraauctions>(idl as never, provider);
  }, [connection, wallet]);
}

export function useReadOnlyProgram(): Program<Umbraauctions> {
  const { connection } = useConnection();

  return useMemo(() => {
    const provider = createReadOnlyProvider(connection);
    return new Program<Umbraauctions>(idl as never, provider);
  }, [connection]);
}

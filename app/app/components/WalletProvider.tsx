"use client";

import { ComponentType, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  type ConnectionProviderProps,
  WalletProvider as SolanaWalletProvider,
  type WalletProviderProps,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  type WalletModalProviderProps,
} from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { RPC_URL } from "../lib/constants";

import "@solana/wallet-adapter-react-ui/styles.css";

const SafeConnectionProvider =
  ConnectionProvider as unknown as ComponentType<ConnectionProviderProps>;
const SafeSolanaWalletProvider =
  SolanaWalletProvider as unknown as ComponentType<WalletProviderProps>;
const SafeWalletModalProvider =
  WalletModalProvider as unknown as ComponentType<WalletModalProviderProps>;

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <SafeConnectionProvider
      endpoint={RPC_URL}
      config={{ commitment: "confirmed" }}
    >
      <SafeSolanaWalletProvider wallets={wallets} autoConnect>
        <SafeWalletModalProvider>{children}</SafeWalletModalProvider>
      </SafeSolanaWalletProvider>
    </SafeConnectionProvider>
  );
}

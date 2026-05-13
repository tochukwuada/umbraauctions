import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./components/WalletProvider";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Toaster } from "./components/Toaster";

export const metadata: Metadata = {
  title: "Umbra",
  description:
    "Sealed-bid NFT auctions on Solana, powered by Arcium MPC.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <div className="relative min-h-screen overflow-x-hidden">
            <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_32%),radial-gradient(circle_at_80%_20%,_rgba(220,38,38,0.11),_transparent_24%),linear-gradient(180deg,_rgba(10,10,11,0.92),_#0a0a0b)]" />
            <div className="relative flex min-h-screen flex-col">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster />
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}

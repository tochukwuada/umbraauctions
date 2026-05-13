import { Lock, Coins, Trophy } from "lucide-react";

const steps = [
  {
    icon: Lock,
    title: "Seller escrows the NFT",
    body: "The NFT moves into a program-controlled escrow account and the bidding window opens.",
  },
  {
    icon: Coins,
    title: "Bidders submit sealed bids",
    body: "Collateral is public. The actual bid amount is encrypted in the browser and stays hidden on-chain.",
  },
  {
    icon: Trophy,
    title: "Arcium computes the winner",
    body: "MPC determines the winning slot and settlement price without revealing losing bids.",
  },
];

export function HowItWorks() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {steps.map(({ icon: Icon, title, body }) => (
        <div key={title} className="umbra-panel rounded-3xl p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/5 text-accent">
            <Icon size={18} />
          </div>
          <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
        </div>
      ))}
    </section>
  );
}

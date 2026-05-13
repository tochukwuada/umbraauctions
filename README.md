# Umbra

Sealed-bid NFT auctions on Solana, powered by Arcium MPC.

Umbra implements a first-price blind auction:

- Sellers escrow a classic NFT into the program.
- Bidders lock public SOL collateral and submit an encrypted bid.
- Arcium MPC computes the winning slot without revealing losing bids.
- The winner pays their own bid, not the runner-up price.

## Local flow

1. Build the program:

```bash
arcium build
```

2. Run local MPC tests on a machine with Docker installed:

```bash
arcium test
```

3. Start the frontend:

```bash
cd app
yarn install
yarn dev
```

## Notes

- The protocol supports any bidder count from `1` to `8`.
- The frontend does not reveal the `8`-bidder cap.
- Bidder wallet addresses are intentionally hidden on the auction detail page. Only the winner address is shown after settlement.

## Important paths

- Program: `programs/umbraauctions/src/lib.rs`
- MPC circuit: `encrypted-ixs/src/lib.rs`
- Tests: `tests/umbraauctions.ts`
- Frontend: `app/`

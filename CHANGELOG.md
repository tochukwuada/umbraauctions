# Changelog

## 2026-05-09

- Adjusted `encrypted-ixs/src/lib.rs` so `find_winner` takes `[Enc<Shared, BidEntry>; 8]` instead of `[Enc<Mxe, BidEntry>; 8]`.
- Reason: the rest of the codebase already encrypts bids with `x25519 pubkey + nonce + RescueCipher(sharedSecret)` and `queue_find_winner` already serializes each slot as `x25519_pubkey + nonce + ciphertext`. Arcium's generated schema for `Enc<Mxe, ...>` only accepts `nonce + ciphertext`, which caused `queue_find_winner` to fail with `InvalidArguments` during `arcium test`.
- Adjusted the public activity mask from `[bool; 8]` to `[u8; 8]` and now serialize `1/0` with `plaintext_u8`.
- Reason: this matches the guide's documented fallback path and avoids a second argument-shape ambiguity around `plaintext_bool` in the runtime validator.
- Added a stored encrypted sentinel bid to each auction and reuse that sentinel to pad unused MPC slots during settlement.
- Reason: fewer-than-8-bidder auctions were still failing when unused slots were padded with zeroed `Enc<Shared, BidEntry>` bytes. Reusing one valid inactive ciphertext keeps the circuit input valid for any auction size from 1 to 8 without leaking bidder identities or exposing the fixed-slot detail in the UI.
- Changed `sol_escrow` in `CreateAuction` from an initialized program-owned account to a seeded mutable PDA that remains system-owned until bidders fund it.
- Reason: settlement needs to transfer lamports out of escrow with a system transfer. The program-owned escrow variant caused `instruction spent from the balance of an account it does not own` during the passing localnet test.
- Updated the frontend create flow to generate the encrypted inactive sentinel before `create_auction`, refreshed the app IDL from `target/idl`, and added a local wallet-provider type shim for the Solana wallet adapter stack.
- Reason: the program API changed when sentinel padding was added, and the Next.js production build was failing on a React type mismatch from wallet-adapter transitive mobile typings even though the runtime API was correct.
- Updated `scripts/init_devnet_comp_def.ts` to support `DISABLE_PUBLIC_RPC_FALLBACK=1` during circuit upload recovery.
- Reason: the guide only says to rerun the idempotent upload, but in practice the public devnet fallback can hit severe `429 Too Many Requests` throttling during the chunked upload phase. Keeping retries on the user's dedicated RPC is more reliable once the raw circuit account has already been resized successfully.
- Updated `scripts/init_devnet_comp_def.ts` to support `UPLOAD_PARALLELISM` so upload batches can be throttled without losing checkpoint/resume behavior.
- Reason: the default `Promise.all` fan-out inside each batch was still too bursty for devnet RPC during raw circuit upload and caused repeated `429` / `fetch failed` interruptions. Lowering parallelism is a safer recovery path than abandoning the partial circuit state.

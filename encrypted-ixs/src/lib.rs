use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    #[derive(Copy, Clone)]
    pub struct BidEntry {
        pub amount: u64,
        pub active: u8,
    }

    #[instruction]
    pub fn find_winner(
        bids: [Enc<Shared, BidEntry>; 8],
        max_collaterals: [u64; 8],
        is_active: [u8; 8],
    ) -> (u8, u64, bool) {
        let mut best_index: u8 = 0;
        let mut best_bid: u64 = 0;
        let mut found: bool = false;

        for i in 0..8 {
            let entry = bids[i].to_arcis();
            let amount = entry.amount;
            let cap = max_collaterals[i];
            let amount_le_cap = amount <= cap;
            let effective_bid: u64 = if amount_le_cap { amount } else { cap };

            let enc_active_is_one = entry.active == 1;
            let public_active_is_one = is_active[i] == 1;
            let valid: bool = public_active_is_one && enc_active_is_one;

            let beats_current: bool = effective_bid > best_bid;
            let new_winner: bool = valid && (beats_current || !found);

            best_index = if new_winner { i as u8 } else { best_index };
            best_bid = if new_winner { effective_bid } else { best_bid };
            found = new_winner || found;
        }

        (best_index.reveal(), best_bid.reveal(), found.reveal())
    }
}

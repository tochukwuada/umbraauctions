use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
use arcium_macros::arcium_program;

declare_id!("8kUjxXEnqKNC6ny2tRuJGQMyPqefF6SyGyhbvQWzyaDE");

pub const MAX_BIDDERS: usize = 8;
pub const EMERGENCY_TIMEOUT_SECS: i64 = 86_400;

pub const AUCTION_SEED: &[u8] = b"auction";
pub const BIDDER_SEED: &[u8] = b"bidder";
pub const SOL_ESCROW_SEED: &[u8] = b"sol_escrow";

pub const COMP_DEF_OFFSET_FIND_WINNER: u32 = comp_def_offset("find_winner");

#[arcium_program]
pub mod umbraauctions {
    use super::*;

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        auction_id: u64,
        start_ts: i64,
        end_ts: i64,
        sentinel_amount: [u8; 32],
        sentinel_active: [u8; 32],
        sentinel_pubkey: [u8; 32],
        sentinel_nonce: u128,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(start_ts >= now, AuctionError::InvalidTimeWindow);
        require!(end_ts > start_ts, AuctionError::InvalidTimeWindow);

        let auction = &mut ctx.accounts.auction;
        auction.seller = ctx.accounts.seller.key();
        auction.auction_id = auction_id;
        auction.nft_mint = ctx.accounts.nft_mint.key();
        auction.nft_escrow = ctx.accounts.nft_escrow_ata.key();
        auction.start_ts = start_ts;
        auction.end_ts = end_ts;
        auction.bid_count = 0;
        auction.state = AuctionState::Active;
        auction.settled = false;
        auction.winner_index = 0xFF;
        auction.has_valid_winner = false;
        auction.winning_bid = 0;
        auction.sentinel_amount = sentinel_amount;
        auction.sentinel_active = sentinel_active;
        auction.sentinel_pubkey = sentinel_pubkey;
        auction.sentinel_nonce = sentinel_nonce;
        auction.bump = ctx.bumps.auction;
        auction.sol_escrow_bump = ctx.bumps.sol_escrow;

        let cpi_accounts = Transfer {
            from: ctx.accounts.seller_nft_ata.to_account_info(),
            to: ctx.accounts.nft_escrow_ata.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            1,
        )?;

        Ok(())
    }

    pub fn submit_bid(
        ctx: Context<SubmitBid>,
        max_collateral: u64,
        encrypted_amount: [u8; 32],
        encrypted_active: [u8; 32],
        encrypted_pubkey: [u8; 32],
        encrypted_nonce: u128,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction = &mut ctx.accounts.auction;

        require!(
            auction.state == AuctionState::Active,
            AuctionError::AuctionNotActive
        );
        require!(now >= auction.start_ts, AuctionError::BiddingNotStarted);
        require!(now < auction.end_ts, AuctionError::BiddingEnded);
        require!(
            auction.bid_count < MAX_BIDDERS as u8,
            AuctionError::MaxBiddersReached
        );
        require!(max_collateral > 0, AuctionError::InvalidCollateral);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.bidder.to_account_info(),
                to: ctx.accounts.sol_escrow.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_ctx, max_collateral)?;

        let record = &mut ctx.accounts.bidder_record;
        record.auction = auction.key();
        record.bidder = ctx.accounts.bidder.key();
        record.bidder_index = auction.bid_count;
        record.max_collateral = max_collateral;
        record.encrypted_amount = encrypted_amount;
        record.encrypted_active = encrypted_active;
        record.encrypted_pubkey = encrypted_pubkey;
        record.encrypted_nonce = encrypted_nonce;
        record.refunded = false;
        record.bump = ctx.bumps.bidder_record;

        auction.bid_count = auction
            .bid_count
            .checked_add(1)
            .ok_or(AuctionError::InvalidAuctionState)?;

        Ok(())
    }

    pub fn init_find_winner_comp_def(ctx: Context<InitFindWinnerCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn queue_find_winner<'info>(
        ctx: Context<'_, '_, 'info, 'info, QueueFindWinner<'info>>,
        computation_offset: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction = &ctx.accounts.auction;
        let auction_key = auction.key();
        let bid_count = auction.bid_count as usize;

        require!(now >= auction.end_ts, AuctionError::BiddingStillOpen);
        require!(
            auction.state == AuctionState::Active
                || auction.state == AuctionState::BiddingClosed
                || auction.state == AuctionState::SettlementFailed,
            AuctionError::InvalidAuctionState
        );
        require!(bid_count > 0, AuctionError::InvalidAuctionState);
        require!(
            ctx.remaining_accounts.len() == bid_count,
            AuctionError::InvalidAuctionState
        );

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut builder = ArgBuilder::new();
        let mut collaterals = [0u64; MAX_BIDDERS];
        let mut is_active = [0u8; MAX_BIDDERS];

        for i in 0..MAX_BIDDERS {
            if i < bid_count {
                let acc_info = &ctx.remaining_accounts[i];
                require_keys_eq!(
                    *acc_info.owner,
                    *ctx.program_id,
                    AuctionError::BidderRecordMismatch
                );

                let record: Account<BidderRecord> = Account::try_from(acc_info)?;
                let (expected_pda, _) = Pubkey::find_program_address(
                    &[BIDDER_SEED, auction_key.as_ref(), record.bidder.as_ref()],
                    ctx.program_id,
                );

                require_keys_eq!(
                    acc_info.key(),
                    expected_pda,
                    AuctionError::BidderRecordMismatch
                );
                require_keys_eq!(
                    record.auction,
                    auction_key,
                    AuctionError::BidderRecordMismatch
                );
                require!(
                    record.bidder_index == i as u8,
                    AuctionError::BidderRecordMismatch
                );

                builder = builder
                    .x25519_pubkey(record.encrypted_pubkey)
                    .plaintext_u128(record.encrypted_nonce)
                    .encrypted_u64(record.encrypted_amount)
                    .encrypted_u8(record.encrypted_active);
                collaterals[i] = record.max_collateral;
                is_active[i] = 1;
            } else {
                builder = builder
                    .x25519_pubkey(auction.sentinel_pubkey)
                    .plaintext_u128(auction.sentinel_nonce)
                    .encrypted_u64(auction.sentinel_amount)
                    .encrypted_u8(auction.sentinel_active);
            }
        }

        for collateral in collaterals {
            builder = builder.plaintext_u64(collateral);
        }

        for active in is_active {
            builder = builder.plaintext_u8(active);
        }

        let args = builder.build();
        let callback_ix = FindWinnerCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: auction_key,
                is_writable: true,
            }],
        )?;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![callback_ix],
            1,
            0,
        )?;

        ctx.accounts.auction.state = AuctionState::SettlementPending;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "find_winner")]
    pub fn find_winner_callback(
        ctx: Context<FindWinnerCallback>,
        output: SignedComputationOutputs<FindWinnerOutput>,
    ) -> Result<()> {
        let (winner_index, winning_bid, has_valid_winner) = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(FindWinnerOutput {
                field_0:
                    FindWinnerOutputStruct0 {
                        field_0,
                        field_1,
                        field_2,
                    },
            }) => (field_0, field_1, field_2),
            Err(e) => {
                msg!("find_winner verification failed: {}", e);
                let auction = &mut ctx.accounts.auction;
                auction.state = AuctionState::SettlementFailed;
                return Err(AuctionError::ComputationFailed.into());
            }
        };

        let auction = &mut ctx.accounts.auction;
        auction.winner_index = if has_valid_winner { winner_index } else { 0xFF };
        auction.winning_bid = winning_bid;
        auction.has_valid_winner = has_valid_winner;
        auction.settled = true;
        auction.state = if has_valid_winner {
            AuctionState::Settled
        } else {
            AuctionState::EmergencyClosed
        };

        Ok(())
    }

    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        require!(
            auction.state == AuctionState::Settled,
            AuctionError::InvalidAuctionState
        );
        require!(auction.has_valid_winner, AuctionError::InvalidAuctionState);
        require!(
            auction.winner_index < MAX_BIDDERS as u8,
            AuctionError::InvalidAuctionState
        );

        let winner_record = &ctx.accounts.winner_record;
        require!(
            winner_record.bidder_index == auction.winner_index,
            AuctionError::BidderRecordMismatch
        );
        require_keys_eq!(
            winner_record.auction,
            auction.key(),
            AuctionError::BidderRecordMismatch
        );
        require!(!winner_record.refunded, AuctionError::AlreadyRefunded);

        let winning_bid = auction.winning_bid;
        let excess = winner_record.max_collateral.saturating_sub(winning_bid);

        let auction_id_bytes = auction.auction_id.to_le_bytes();
        let auction_bump = [auction.bump];
        let auction_signer_seeds = &[&[
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.nft_escrow_ata.to_account_info(),
            to: ctx.accounts.winner_nft_ata.to_account_info(),
            authority: ctx.accounts.auction.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                auction_signer_seeds,
            ),
            1,
        )?;

        let auction_key = auction.key();
        let sol_escrow_bump = [auction.sol_escrow_bump];
        let sol_escrow_signer_seeds = &[&[
            SOL_ESCROW_SEED,
            auction_key.as_ref(),
            &sol_escrow_bump,
        ][..]];

        transfer_escrow_lamports(
            &ctx.accounts.system_program,
            &ctx.accounts.sol_escrow.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            sol_escrow_signer_seeds,
            winning_bid,
        )?;
        transfer_escrow_lamports(
            &ctx.accounts.system_program,
            &ctx.accounts.sol_escrow.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            sol_escrow_signer_seeds,
            excess,
        )?;

        ctx.accounts.winner_record.refunded = true;

        Ok(())
    }

    pub fn refund_loser(ctx: Context<RefundLoser>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        require!(
            auction.state == AuctionState::Settled
                || auction.state == AuctionState::EmergencyClosed,
            AuctionError::InvalidAuctionState
        );
        require_keys_eq!(
            ctx.accounts.loser_record.auction,
            auction.key(),
            AuctionError::BidderRecordMismatch
        );
        if auction.has_valid_winner {
            require!(
                ctx.accounts.loser_record.bidder_index != auction.winner_index,
                AuctionError::WinnerCannotRefundAsLoser
            );
        }
        require!(
            !ctx.accounts.loser_record.refunded,
            AuctionError::AlreadyRefunded
        );

        let auction_key = auction.key();
        let sol_escrow_bump = [auction.sol_escrow_bump];
        let signer_seeds = &[&[
            SOL_ESCROW_SEED,
            auction_key.as_ref(),
            &sol_escrow_bump,
        ][..]];
        transfer_escrow_lamports(
            &ctx.accounts.system_program,
            &ctx.accounts.sol_escrow.to_account_info(),
            &ctx.accounts.loser.to_account_info(),
            signer_seeds,
            ctx.accounts.loser_record.max_collateral,
        )?;

        ctx.accounts.loser_record.refunded = true;

        Ok(())
    }

    pub fn cancel_auction(ctx: Context<CancelAuction>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        require!(
            auction.state == AuctionState::Active,
            AuctionError::InvalidAuctionState
        );
        require!(auction.bid_count == 0, AuctionError::CannotCancelAfterBids);

        let auction_id_bytes = auction.auction_id.to_le_bytes();
        let auction_bump = [auction.bump];
        let signer_seeds = &[&[
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.nft_escrow_ata.to_account_info(),
            to: ctx.accounts.seller_nft_ata.to_account_info(),
            authority: ctx.accounts.auction.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            1,
        )?;

        ctx.accounts.auction.state = AuctionState::Cancelled;

        Ok(())
    }

    pub fn emergency_refund(ctx: Context<EmergencyRefund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction = &ctx.accounts.auction;
        let timeout_passed = now > auction.end_ts.saturating_add(EMERGENCY_TIMEOUT_SECS);
        let emergency_conditions = auction.state == AuctionState::SettlementFailed
            || auction.state == AuctionState::EmergencyClosed
            || (timeout_passed && !auction.settled);
        require!(
            emergency_conditions,
            AuctionError::EmergencyConditionsNotMet
        );
        require_keys_eq!(
            ctx.accounts.bidder_record.auction,
            auction.key(),
            AuctionError::BidderRecordMismatch
        );
        require!(
            !ctx.accounts.bidder_record.refunded,
            AuctionError::AlreadyRefunded
        );

        let auction_key = auction.key();
        let sol_escrow_bump = [auction.sol_escrow_bump];
        let signer_seeds = &[&[
            SOL_ESCROW_SEED,
            auction_key.as_ref(),
            &sol_escrow_bump,
        ][..]];
        transfer_escrow_lamports(
            &ctx.accounts.system_program,
            &ctx.accounts.sol_escrow.to_account_info(),
            &ctx.accounts.bidder.to_account_info(),
            signer_seeds,
            ctx.accounts.bidder_record.max_collateral,
        )?;

        ctx.accounts.bidder_record.refunded = true;
        if ctx.accounts.auction.state != AuctionState::EmergencyClosed {
            ctx.accounts.auction.state = AuctionState::EmergencyClosed;
        }

        Ok(())
    }

    pub fn emergency_reclaim_nft(ctx: Context<EmergencyReclaimNft>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction = &ctx.accounts.auction;
        let timeout_passed = now > auction.end_ts.saturating_add(EMERGENCY_TIMEOUT_SECS);
        let emergency_conditions =
            (auction.state == AuctionState::EmergencyClosed && !auction.has_valid_winner)
                || (auction.state == AuctionState::SettlementFailed && timeout_passed)
                || (timeout_passed && !auction.settled);
        require!(
            emergency_conditions,
            AuctionError::EmergencyConditionsNotMet
        );

        let auction_id_bytes = auction.auction_id.to_le_bytes();
        let auction_bump = [auction.bump];
        let signer_seeds = &[&[
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.nft_escrow_ata.to_account_info(),
            to: ctx.accounts.seller_nft_ata.to_account_info(),
            authority: ctx.accounts.auction.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            1,
        )?;

        ctx.accounts.auction.state = AuctionState::EmergencyClosed;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = seller,
    )]
    pub seller_nft_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = seller,
        space = 8 + Auction::INIT_SPACE,
        seeds = [AUCTION_SEED, seller.key().as_ref(), &auction_id.to_le_bytes()],
        bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        init,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = auction,
    )]
    pub nft_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction.key().as_ref()],
        bump,
    )]
    /// CHECK: PDA used only to hold SOL collateral. Left system-owned so lamports can move via System Program CPI.
    pub sol_escrow: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        init,
        payer = bidder,
        space = 8 + BidderRecord::INIT_SPACE,
        seeds = [BIDDER_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub bidder_record: Account<'info, BidderRecord>,

    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction.key().as_ref()],
        bump = auction.sol_escrow_bump,
    )]
    /// CHECK: PDA used only to hold SOL collateral. Seeds enforce the address.
    pub sol_escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("find_winner", payer)]
#[derive(Accounts)]
pub struct InitFindWinnerCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    /// CHECK: Created by Arcium init_comp_def. Validated by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: PDA derived from the MXE account LUT slot and constrained by address.
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Address is constrained to the canonical LUT program id.
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("find_winner", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueFindWinner<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: PDA derived and validated by Arcium.
    #[account(mut, address = derive_mempool_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub mempool_account: UncheckedAccount<'info>,

    /// CHECK: PDA derived and validated by Arcium.
    #[account(mut, address = derive_execpool_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub executing_pool: UncheckedAccount<'info>,

    /// CHECK: PDA derived and validated by Arcium.
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, AuctionError::InvalidAuctionState))]
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIND_WINNER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("find_winner")]
#[derive(Accounts)]
pub struct FindWinnerCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIND_WINNER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Validated by the Arcium program before callback dispatch.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    /// CHECK: Sysvar address constraint.
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [BIDDER_SEED, auction.key().as_ref(), winner.key().as_ref()],
        bump = winner_record.bump,
        constraint = winner_record.auction == auction.key() @ AuctionError::BidderRecordMismatch,
    )]
    pub winner_record: Account<'info, BidderRecord>,

    #[account(mut, address = winner_record.bidder)]
    pub winner: SystemAccount<'info>,

    #[account(mut, address = auction.seller)]
    pub seller: SystemAccount<'info>,

    #[account(address = auction.nft_mint)]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = nft_escrow_ata.key() == auction.nft_escrow @ AuctionError::InvalidAuctionState,
        token::mint = nft_mint,
        token::authority = auction,
    )]
    pub nft_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = nft_mint,
        associated_token::authority = winner,
    )]
    pub winner_nft_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction.key().as_ref()],
        bump = auction.sol_escrow_bump,
    )]
    /// CHECK: PDA used only to hold SOL collateral. Seeds enforce the address.
    pub sol_escrow: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundLoser<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [BIDDER_SEED, auction.key().as_ref(), loser.key().as_ref()],
        bump = loser_record.bump,
        constraint = loser_record.auction == auction.key() @ AuctionError::BidderRecordMismatch,
    )]
    pub loser_record: Account<'info, BidderRecord>,

    #[account(mut, address = loser_record.bidder)]
    pub loser: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction.key().as_ref()],
        bump = auction.sol_escrow_bump,
    )]
    /// CHECK: PDA used only to hold SOL collateral. Seeds enforce the address.
    pub sol_escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelAuction<'info> {
    #[account(mut, address = auction.seller)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(address = auction.nft_mint)]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = nft_escrow_ata.key() == auction.nft_escrow @ AuctionError::InvalidAuctionState,
        token::mint = nft_mint,
        token::authority = auction,
    )]
    pub nft_escrow_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyRefund<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [BIDDER_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump = bidder_record.bump,
        constraint = bidder_record.auction == auction.key() @ AuctionError::BidderRecordMismatch,
    )]
    pub bidder_record: Account<'info, BidderRecord>,

    #[account(mut, address = bidder_record.bidder)]
    pub bidder: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction.key().as_ref()],
        bump = auction.sol_escrow_bump,
    )]
    /// CHECK: PDA used only to hold SOL collateral. Seeds enforce the address.
    pub sol_escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyReclaimNft<'info> {
    #[account(mut, address = auction.seller)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(address = auction.nft_mint)]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = nft_escrow_ata.key() == auction.nft_escrow @ AuctionError::InvalidAuctionState,
        token::mint = nft_mint,
        token::authority = auction,
    )]
    pub nft_escrow_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AuctionState {
    Active,
    BiddingClosed,
    SettlementPending,
    Settled,
    SettlementFailed,
    Cancelled,
    EmergencyClosed,
}

#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub seller: Pubkey,
    pub auction_id: u64,
    pub nft_mint: Pubkey,
    pub nft_escrow: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub bid_count: u8,
    pub state: AuctionState,
    pub settled: bool,
    pub winner_index: u8,
    pub has_valid_winner: bool,
    pub winning_bid: u64,
    pub sentinel_amount: [u8; 32],
    pub sentinel_active: [u8; 32],
    pub sentinel_pubkey: [u8; 32],
    pub sentinel_nonce: u128,
    pub bump: u8,
    pub sol_escrow_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BidderRecord {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub bidder_index: u8,
    pub max_collateral: u64,
    pub encrypted_amount: [u8; 32],
    pub encrypted_active: [u8; 32],
    pub encrypted_pubkey: [u8; 32],
    pub encrypted_nonce: u128,
    pub refunded: bool,
    pub bump: u8,
}

#[error_code]
pub enum AuctionError {
    #[msg("Auction is not in active state")]
    AuctionNotActive,
    #[msg("Bidding window has not started")]
    BiddingNotStarted,
    #[msg("Bidding window has ended")]
    BiddingEnded,
    #[msg("Bidding window is still open")]
    BiddingStillOpen,
    #[msg("Maximum bidder count reached")]
    MaxBiddersReached,
    #[msg("Invalid time window")]
    InvalidTimeWindow,
    #[msg("Insufficient bidder funds for max_collateral")]
    InsufficientFunds,
    #[msg("max_collateral must be greater than zero")]
    InvalidCollateral,
    #[msg("Settlement has not been computed")]
    SettlementNotComputed,
    #[msg("Settlement has already been computed")]
    SettlementAlreadyComputed,
    #[msg("Cannot cancel: bids have already been submitted")]
    CannotCancelAfterBids,
    #[msg("Emergency conditions are not met")]
    EmergencyConditionsNotMet,
    #[msg("Computation failed")]
    ComputationFailed,
    #[msg("Invalid auction state for this operation")]
    InvalidAuctionState,
    #[msg("Bidder record mismatch")]
    BidderRecordMismatch,
    #[msg("Caller is not the winner")]
    NotWinner,
    #[msg("Caller is the winner; use settle_auction instead of refund_loser")]
    WinnerCannotRefundAsLoser,
    #[msg("Bidder has already been refunded")]
    AlreadyRefunded,
    #[msg("NFT mint does not match auction's expected mint")]
    NftMintMismatch,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Cluster not set on MXE account")]
    ClusterNotSet,
}

fn transfer_escrow_lamports<'info>(
    system_program: &Program<'info, System>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: from.clone(),
                to: to.clone(),
            },
            signer_seeds,
        ),
        amount,
    )
}

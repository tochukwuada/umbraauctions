import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount as getTokenAccount,
} from "@solana/spl-token";
import {
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import { Umbraauctions } from "../target/types/umbraauctions";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  getFeePoolAccAddress,
  getClockAccAddress,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

const AUCTION_SEED = Buffer.from("auction");
const BIDDER_SEED = Buffer.from("bidder");
const SOL_ESCROW_SEED = Buffer.from("sol_escrow");

describe("umbraauctions", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Umbraauctions as Program<Umbraauctions>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumProgram = getArciumProgram(provider);
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  const auctionPda = (seller: PublicKey, auctionId: bigint) =>
    PublicKey.findProgramAddressSync(
      [AUCTION_SEED, seller.toBuffer(), toLeU64(auctionId)],
      program.programId
    )[0];
  const bidderRecordPda = (auction: PublicKey, bidder: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [BIDDER_SEED, auction.toBuffer(), bidder.toBuffer()],
      program.programId
    )[0];
  const solEscrowPda = (auction: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [SOL_ESCROW_SEED, auction.toBuffer()],
      program.programId
    )[0];

  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const seller = Keypair.generate();
  const bidder0 = Keypair.generate();
  const bidder1 = Keypair.generate();
  const bidder2 = Keypair.generate();

  let mxePublicKey: Uint8Array;
  let nftMint: PublicKey;
  let auction: PublicKey;
  let nftEscrowAta: PublicKey;
  let solEscrow: PublicKey;
  let sellerNftAta: PublicKey;

  before("setup: airdrops, nft mint, comp def init", async function () {
    this.timeout(300_000);

    for (const kp of [seller, bidder0, bidder1, bidder2]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        100 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);

    const mintKeypair = Keypair.generate();
    nftMint = await createMetaplexNft(
      provider.connection,
      seller,
      mintKeypair
    );
    sellerNftAta = getAssociatedTokenAddressSync(nftMint, seller.publicKey);

    const auctionId = 1n;
    auction = auctionPda(seller.publicKey, auctionId);
    nftEscrowAta = getAssociatedTokenAddressSync(nftMint, auction, true);
    solEscrow = solEscrowPda(auction);

    await initFindWinnerCompDef();
  });

  it("runs full first-price auction E2E with 3 bidders and settles at the winning bid", async function () {
    this.timeout(600_000);

    const auctionId = 1n;
    const slot = await provider.connection.getSlot("confirmed");
    const now = await provider.connection.getBlockTime(slot);
    if (now === null) throw new Error("Failed to read validator clock");

    const startTs = new anchor.BN(now + 5);
    const endTs = new anchor.BN(now + 30);
    const sentinel = encryptBidPayload(0n, mxePublicKey, false);

    await program.methods
      .createAuction(
        new anchor.BN(auctionId.toString()),
        startTs,
        endTs,
        sentinel.ciphertext0,
        sentinel.ciphertext1,
        sentinel.pubKey,
        sentinel.nonce
      )
      .accountsPartial({
        seller: seller.publicKey,
        nftMint,
        sellerNftAta,
        auction,
        nftEscrowAta,
        solEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    let auctionAcc = await program.account.auction.fetch(auction);
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ active: {} })
    );
    expect(auctionAcc.bidCount).to.equal(0);

    const escrowAfterCreate = await getTokenAccount(
      provider.connection,
      nftEscrowAta
    );
    expect(escrowAfterCreate.amount.toString()).to.equal("1");

    while (true) {
      const currentSlot = await provider.connection.getSlot("confirmed");
      const currentTime = await provider.connection.getBlockTime(currentSlot);
      if (currentTime !== null && currentTime >= startTs.toNumber() + 1) {
        break;
      }
      await sleep(2_000);
    }

    const bidScenario = [
      {
        kp: bidder0,
        bid: 1n * BigInt(LAMPORTS_PER_SOL),
        max: 2n * BigInt(LAMPORTS_PER_SOL),
      },
      {
        kp: bidder1,
        bid: 5n * BigInt(LAMPORTS_PER_SOL),
        max: 6n * BigInt(LAMPORTS_PER_SOL),
      },
      {
        kp: bidder2,
        bid: 3n * BigInt(LAMPORTS_PER_SOL),
        max: 4n * BigInt(LAMPORTS_PER_SOL),
      },
    ];

    for (const { kp, bid, max } of bidScenario) {
      const bidderPriv = x25519.utils.randomSecretKey();
      const bidderPub = x25519.getPublicKey(bidderPriv);
      const sharedSecret = x25519.getSharedSecret(bidderPriv, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);
      const nonce = randomBytes(16);
      const ciphertext = cipher.encrypt([bid, 1n], nonce);

      await program.methods
        .submitBid(
          new anchor.BN(max.toString()),
          Array.from(ciphertext[0]),
          Array.from(ciphertext[1]),
          Array.from(bidderPub),
          new anchor.BN(deserializeLE(nonce).toString())
        )
        .accountsPartial({
          bidder: kp.publicKey,
          auction,
          bidderRecord: bidderRecordPda(auction, kp.publicKey),
          solEscrow,
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc({ skipPreflight: false, commitment: "confirmed" });
    }

    auctionAcc = await program.account.auction.fetch(auction);
    expect(auctionAcc.bidCount).to.equal(3);

    const totalCollateral = bidScenario.reduce((acc, bid) => acc + bid.max, 0n);
    const escrowBal = BigInt(await provider.connection.getBalance(solEscrow));
    expect(escrowBal >= totalCollateral).to.equal(true);

    while (true) {
      const currentSlot = await provider.connection.getSlot("confirmed");
      const currentTime = await provider.connection.getBlockTime(currentSlot);
      if (currentTime !== null && currentTime >= endTs.toNumber() + 1) {
        break;
      }
      await sleep(2_000);
    }

    const sellerBalBefore = BigInt(
      await provider.connection.getBalance(seller.publicKey)
    );
    const bidder0BalBefore = BigInt(
      await provider.connection.getBalance(bidder0.publicKey)
    );
    const bidder1BalBefore = BigInt(
      await provider.connection.getBalance(bidder1.publicKey)
    );
    const bidder2BalBefore = BigInt(
      await provider.connection.getBalance(bidder2.publicKey)
    );
    const solEscrowBefore = BigInt(
      await provider.connection.getBalance(solEscrow)
    );

    const computationOffset = new anchor.BN(Date.now().toString());
    const remainingAccounts = bidScenario.map(({ kp }) => ({
      pubkey: bidderRecordPda(auction, kp.publicKey),
      isSigner: false,
      isWritable: false,
    }));

    await program.methods
      .queueFindWinner(computationOffset)
      .accountsPartial({
        payer: seller.publicKey,
        auction,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset
        ),
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("find_winner")).readUInt32LE()
        ),
        clusterAccount,
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([seller])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );

    auctionAcc = await waitForAuctionSettlementState(
      program,
      provider.connection,
      auction,
      finalizeSig,
      getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset
      )
    );

    expect(auctionAcc.hasValidWinner).to.equal(true);
    expect(auctionAcc.winnerIndex).to.equal(1);
    expect(auctionAcc.winningBid.toString()).to.equal(
      (5n * BigInt(LAMPORTS_PER_SOL)).toString()
    );
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ settled: {} })
    );

    const winnerNftAta = getAssociatedTokenAddressSync(
      nftMint,
      bidder1.publicKey
    );
    await program.methods
      .settleAuction()
      .accountsPartial({
        caller: bidder1.publicKey,
        auction,
        winnerRecord: bidderRecordPda(auction, bidder1.publicKey),
        winner: bidder1.publicKey,
        seller: seller.publicKey,
        nftMint,
        nftEscrowAta,
        winnerNftAta,
        solEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    const winnerRecord = await program.account.bidderRecord.fetch(
      bidderRecordPda(auction, bidder1.publicKey)
    );
    expect(winnerRecord.refunded).to.equal(true);

    const winnerNftBal = await getTokenAccount(provider.connection, winnerNftAta);
    expect(winnerNftBal.amount.toString()).to.equal("1");

    const sellerBalAfter = BigInt(
      await provider.connection.getBalance(seller.publicKey)
    );
    const sellerDelta = sellerBalAfter - sellerBalBefore;
    const expectedSellerDelta = 5n * BigInt(LAMPORTS_PER_SOL);
    const sellerTolerance = BigInt(0.02 * LAMPORTS_PER_SOL);
    expect(Number(sellerDelta)).to.be.gte(
      Number(expectedSellerDelta - sellerTolerance)
    );
    expect(Number(sellerDelta)).to.be.lte(
      Number(expectedSellerDelta + sellerTolerance)
    );

    const winnerBalAfterSettle = BigInt(
      await provider.connection.getBalance(bidder1.publicKey)
    );
    const winnerDelta = winnerBalAfterSettle - bidder1BalBefore;
    expect(Number(winnerDelta)).to.be.gt(0.8 * LAMPORTS_PER_SOL);
    expect(Number(winnerDelta)).to.be.lt(1.1 * LAMPORTS_PER_SOL);

    await refundLoser(
      bidScenario[0].kp,
      bidder0BalBefore,
      2n * BigInt(LAMPORTS_PER_SOL)
    );
    await refundLoser(
      bidScenario[2].kp,
      bidder2BalBefore,
      4n * BigInt(LAMPORTS_PER_SOL)
    );

    const bidder0Record = await program.account.bidderRecord.fetch(
      bidderRecordPda(auction, bidder0.publicKey)
    );
    const bidder2Record = await program.account.bidderRecord.fetch(
      bidderRecordPda(auction, bidder2.publicKey)
    );
    expect(bidder0Record.refunded).to.equal(true);
    expect(bidder2Record.refunded).to.equal(true);

    const escrowAfterRefunds = BigInt(
      await provider.connection.getBalance(solEscrow)
    );
    const rentFloor = BigInt(
      await provider.connection.getMinimumBalanceForRentExemption(0)
    );
    expect(escrowAfterRefunds <= rentFloor).to.equal(true);
    expect(solEscrowBefore >= escrowAfterRefunds).to.equal(true);
  });

  async function refundLoser(
    loser: Keypair,
    balanceBefore: bigint,
    expectedRefund: bigint
  ) {
    await program.methods
      .refundLoser()
      .accountsPartial({
        caller: loser.publicKey,
        auction,
        loserRecord: bidderRecordPda(auction, loser.publicKey),
        loser: loser.publicKey,
        solEscrow,
        systemProgram: SystemProgram.programId,
      })
      .signers([loser])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    const balanceAfter = BigInt(
      await provider.connection.getBalance(loser.publicKey)
    );
    const delta = balanceAfter - balanceBefore;
    const feeTolerance = BigInt(0.001 * LAMPORTS_PER_SOL);
    expect(Number(delta)).to.be.gte(Number(expectedRefund - feeTolerance));
    expect(Number(delta)).to.be.lte(Number(expectedRefund));
  }

  async function initFindWinnerCompDef(): Promise<void> {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("find_winner");
    const compDefPda = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const existing = await provider.connection.getAccountInfo(compDefPda);
    if (existing !== null) {
      return;
    }

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot
    );

    await withBlockhashRetry("initFindWinnerCompDef", async () => {
      await program.methods
        .initFindWinnerCompDef()
        .accounts({
          compDefAccount: compDefPda,
          payer: owner.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
    });

    const rawCircuit = fs.readFileSync("build/find_winner.arcis");
    await withBlockhashRetry("uploadCircuit(find_winner)", async () => {
      await uploadCircuit(
        provider,
        "find_winner",
        program.programId,
        rawCircuit,
        true,
        500,
        {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          commitment: "confirmed",
        }
      );
    });
  }
});

async function withBlockhashRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries: number = 5,
  retryDelayMs: number = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Blockhash not found") || attempt === maxRetries) {
        throw error;
      }

      await sleep(retryDelayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${maxRetries} attempts`);
}

async function waitForAuctionSettlementState(
  program: Program<Umbraauctions>,
  connection: anchor.web3.Connection,
  auction: PublicKey,
  finalizeSig: string,
  computationAccount: PublicKey,
  timeoutMs: number = 30_000,
  pollIntervalMs: number = 1_000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const auctionAcc = await program.account.auction.fetch(auction);
    if (JSON.stringify(auctionAcc.state) !== JSON.stringify({ settlementPending: {} })) {
      return auctionAcc;
    }
    await sleep(pollIntervalMs);
  }

  const finalizeTx = await connection.getTransaction(finalizeSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (finalizeTx?.meta?.logMessages) {
    for (const log of finalizeTx.meta.logMessages) {
      console.error(log);
    }
  }

  const auctionSigs = await connection.getSignaturesForAddress(
    auction,
    { limit: 5 },
    "confirmed"
  );
  console.error(
    "Recent auction signatures:",
    auctionSigs.map((sig) => sig.signature)
  );

  const compSigs = await connection.getSignaturesForAddress(
    computationAccount,
    { limit: 5 },
    "confirmed"
  );
  const arciumProgram = getArciumProgram(program.provider as anchor.AnchorProvider);
  const computationAcc = await arciumProgram.account.computationAccount.fetchNullable(
    computationAccount,
    "confirmed"
  );
  console.error(
    "Computation account status:",
    computationAcc ? JSON.stringify(computationAcc.status) : "missing"
  );
  if (computationAcc) {
    console.error(
      "Callback delivery state:",
      JSON.stringify({
        callbackTransactionsRequired:
          computationAcc.callbackTransactionsRequired,
        callbackTransactionsSubmittedBm:
          computationAcc.callbackTransactionsSubmittedBm,
        customCallbackInstructions: computationAcc.customCallbackInstructions,
      })
    );
  }
  console.error(
    "Recent computation signatures:",
    compSigs.map((sig) => sig.signature)
  );
  for (const sig of auctionSigs) {
    const tx = await connection.getTransaction(sig.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.logMessages) {
      console.error(`Logs for auction signature ${sig.signature}:`);
      for (const log of tx.meta.logMessages) {
        console.error(log);
      }
    }
  }
  for (const sig of compSigs) {
    const tx = await connection.getTransaction(sig.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.logMessages) {
      console.error(`Logs for computation signature ${sig.signature}:`);
      for (const log of tx.meta.logMessages) {
        console.error(log);
      }
    }
  }

  throw new Error(`Auction callback did not update state within ${timeoutMs}ms`);
}

function encryptBidPayload(
  bidLamports: bigint,
  mxePubkey: Uint8Array,
  active: boolean
): {
  ciphertext0: number[];
  ciphertext1: number[];
  pubKey: number[];
  nonce: anchor.BN;
} {
  const bidderPriv = x25519.utils.randomSecretKey();
  const bidderPub = x25519.getPublicKey(bidderPriv);
  const sharedSecret = x25519.getSharedSecret(bidderPriv, mxePubkey);
  const cipher = new RescueCipher(sharedSecret);
  const nonceBytes = randomBytes(16);
  const ciphertext = cipher.encrypt(
    [bidLamports, active ? 1n : 0n],
    nonceBytes
  );

  return {
    ciphertext0: Array.from(ciphertext[0]),
    ciphertext1: Array.from(ciphertext[1]),
    pubKey: Array.from(bidderPub),
    nonce: new anchor.BN(deserializeLE(nonceBytes).toString()),
  };
}

async function createMetaplexNft(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mintKeypair: Keypair
): Promise<PublicKey> {
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    0,
    mintKeypair
  );
  const ata = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  await mintTo(connection, payer, mint, ata, payer, 1);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  const ix = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadataPda,
      mint,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: "UmbraTestNFT",
          symbol: "UMTN",
          uri: "https://example.com/test.json",
          sellerFeeBasisPoints: 0,
          creators: null,
          collection: null,
          uses: null,
        },
        isMutable: true,
        collectionDetails: null,
      },
    }
  );

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [payer]);
  return mint;
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePubkey = await getMXEPublicKey(provider, programId);
      if (mxePubkey) return mxePubkey;
    } catch {
      // ignore and retry
    }

    if (attempt < maxRetries) {
      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(filePath: string): anchor.web3.Keypair {
  const file = fs.readFileSync(filePath);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}

function toLeU64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

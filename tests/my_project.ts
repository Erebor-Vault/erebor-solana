// Anchor client library — wallet, provider, and typed program abstractions
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// Auto-generated TypeScript types from `anchor build` — gives type-safe program interaction
import { MyProject } from "../target/types/my_project";
// Solana web3.js primitives:
// - Keypair: generates ed25519 key pairs (public + private key)
// - PublicKey: a 32-byte Solana address (base58-encoded)
// - SystemProgram: built-in program for creating accounts and transferring SOL
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
// SPL Token helpers — like a convenience SDK for interacting with ERC-20-style tokens:
// - createMint: deploy a new token type (like deploying an ERC-20 contract)
// - createAssociatedTokenAccount: create a wallet's ATA for a specific mint
// - mintTo: mint new tokens (like ERC-20 _mint)
// - TOKEN_PROGRAM_ID: address of the SPL Token program
// - ASSOCIATED_TOKEN_PROGRAM_ID: address of the ATA program (derives deterministic token accounts)
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
// BN.js for large numbers — Solana uses u64 which exceeds JS Number.MAX_SAFE_INTEGER
import { BN } from "bn.js";
import { assert } from "chai";

describe("my_project", () => {
  // AnchorProvider.env() reads cluster URL + wallet from Anchor.toml and local keypair.
  // Bundles: connection (RPC client) + wallet (tx signer). Like ethers.js Provider + Signer combined.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // anchor.workspace auto-loads programs from Anchor.toml using the IDL in target/types/.
  // IDL = Interface Definition Language (like Solidity ABI). Gives us typed methods.
  const program = anchor.workspace.myProject as Program<MyProject>;
  const connection = provider.connection;

  // Random keypair for the vault — not used in the updated test (counter PDA is the vault now)
  const vaultAuthority = Keypair.generate();

  it("Is initialized!", async () => {
    // Fresh keypair for the test user. Each test can use a new one for isolation.
    const keypair = Keypair.generate();

    // Airdrop 1 SOL (1e9 lamports) so the keypair can pay for transactions.
    // 1 SOL = 1,000,000,000 lamports (like 1 ETH = 1e18 wei).
    // Only works on localnet/devnet.
    const sig = await connection.requestAirdrop(keypair.publicKey, 1e9);
    // Confirm the airdrop — blockhash + lastValidBlockHeight define the tx validity window.
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    await connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: sig,
    });

    // ========== TOKEN SETUP ==========

    // Create a new token mint — like deploying an ERC-20 contract.
    // Args: connection, payer, mintAuthority (who can mint), freezeAuthority (null = none), decimals
    // 6 decimals = standard for stablecoins (USDC). 1_000_000 smallest units = 1.0 tokens.
    const mint = await createMint(
      connection,
      provider.wallet.payer, // fee payer
      provider.wallet.payer.publicKey, // mint authority — who can create new tokens
      null, // freeze authority — null means tokens can never be frozen
      6 // decimals
    );

    // Create the user's ATA (Associated Token Account) for this mint.
    // Each wallet needs a separate account per token type (unlike ERC-20 where the contract tracks balances).
    // ATA = deterministic address derived from (wallet, mint) — anyone can compute it without on-chain lookup.
    const userTokenAccount = await createAssociatedTokenAccount(
      connection,
      provider.wallet.payer, // fee payer (doesn't have to be the owner)
      mint, // which token
      keypair.publicKey // wallet that will own this token account
    );

    // Mint 1.1 tokens (1_100_000 with 6 decimals) to the user's ATA.
    // Like calling ERC20._mint(userAddress, amount).
    const amountToMint = 1_100_000;

    const mintSignature = await mintTo(
      connection,
      provider.wallet.payer, // fee payer
      mint, // which token to mint
      userTokenAccount, // where to deposit
      provider.wallet.payer, // mint authority (must match createMint's mintAuthority)
      amountToMint // amount in smallest units
    );

    // Confirm the mint tx before checking balances
    {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();

      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature: mintSignature,
      });
    }

    // Verify minted balance. getTokenAccountBalance returns amount as string + parsed info.
    const balance = await connection.getTokenAccountBalance(userTokenAccount);

    console.log(balance);

    // balance.value.amount is a string of raw units (e.g., "1100000")
    assert.ok(+balance.value.amount === amountToMint);

    // ========== INITIALIZE THE COUNTER PDA ==========

    // Derive the counter PDA address client-side — must use same seeds as the Rust code.
    // findProgramAddressSync returns [address, bump].
    // Like computing a mapping key: keccak256(abi.encode("counter", msg.sender)) in Solidity.
    const [counterPdaAddress, counterBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), keypair.publicKey.toBuffer()],
      program.programId
    );

    // Call the initialize instruction.
    // program.methods.initialize() builds the tx for the `initialize` instruction handler.
    // .accountsStrict() passes ALL required accounts — must match the Rust Initialize struct exactly.
    // .signers() specifies which keypairs sign (provider wallet signs automatically).
    // .rpc() sends the tx and returns the signature.
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        signer: keypair.publicKey, // must match Signer<'info> — verified on-chain
        counter: counterPdaAddress, // PDA to create — Anchor verifies it matches the seeds
        systemProgram: SystemProgram.programId, // required for account creation (init)
      })
      .signers([keypair]) // keypair must sign because it's the Signer in the Rust struct
      .rpc();

    console.log("Your transaction signature", tx);

    // Fetch and verify on-chain state.
    // program.account.counter.fetch() deserializes the PDA's data into a Counter object.
    // Like calling a Solidity view function: counter.value()
    const accountState = await program.account.counter.fetch(counterPdaAddress);
    console.log("Signer address", keypair.publicKey.toBase58());
    console.log(accountState);

    // ========== CREATE PDA's TOKEN ACCOUNT ==========

    // Create an ATA owned by the counter PDA itself.
    // The last arg `true` = allowOwnerOffCurve, which is required because PDAs are off-curve
    // (they don't have private keys, so they're not normal wallet addresses).
    // This account will hold tokens "locked" in the counter.
    const counterPdaTokenAccount = await createAssociatedTokenAccount(
      connection,
      provider.wallet.payer, // fee payer
      mint, // which token
      counterPdaAddress, // owner = the PDA (not a regular wallet!)
      undefined, // commitment
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      true // allowOwnerOffCurve — MUST be true for PDA-owned ATAs
    );

    // ========== INCREMENT: User → PDA ==========

    // Transfer 1.0 tokens (1_000_000) from user to counter PDA.
    // The Rust handler will: 1) check balance, 2) increment counter, 3) CPI transfer tokens.
    const incrementBy = new BN(1_000_000);
    await program.methods
      .increment(incrementBy)
      .accountsStrict({
        signer: keypair.publicKey,
        counter: counterPdaAddress,
        sourceTokenAccount: userTokenAccount, // user's ATA — tokens deducted from here
        destinationTokenAccount: counterPdaTokenAccount, // PDA's ATA — tokens deposited here
        tokenMint: mint, // Anchor verifies ATAs match this mint
        tokenProgram: TOKEN_PROGRAM_ID, // SPL Token program that processes the transfer
      })
      .signers([keypair])
      .rpc();

    // Verify counter was incremented
    const afterUpdate = await program.account.counter.fetch(counterPdaAddress);

    console.log("After update", afterUpdate);

    // .eq() compares BN values (can't use === for big numbers)
    assert.ok(afterUpdate.value.eq(incrementBy));

    // Verify token balances after increment:
    // User: 1_100_000 - 1_000_000 = 100_000 (0.1 tokens)
    // PDA:  0 + 1_000_000 = 1_000_000 (1.0 tokens)
    const userBalanceAfter = await connection.getTokenAccountBalance(
      userTokenAccount
    );
    const counterBalanceAfter = await connection.getTokenAccountBalance(
      counterPdaTokenAccount
    );

    console.log(userBalanceAfter, counterBalanceAfter);

    assert.ok(
      +userBalanceAfter.value.amount === amountToMint - incrementBy.toNumber()
    );
    assert.ok(+counterBalanceAfter.value.amount === incrementBy.toNumber());

    // ========== DECREMENT: PDA → User ==========

    // Transfer 0.5 tokens (500_000) FROM the counter PDA back to the user.
    // Key difference: the PDA signs the transfer using with_signer(seeds) in the Rust code,
    // since the PDA owns the source token account but has no private key.
    {
      const userBalanceBeforeDecrement =
        await connection.getTokenAccountBalance(userTokenAccount);
      const counterBalanceBeforeDecrement =
        await connection.getTokenAccountBalance(counterPdaTokenAccount);

      const decrementBy = new BN(500_000);
      await program.methods
        .decrement(decrementBy)
        .accountsStrict({
          signer: keypair.publicKey,
          counter: counterPdaAddress,
          sourceTokenAccount: counterPdaTokenAccount, // PDA's ATA — tokens come from here
          destinationTokenAccount: userTokenAccount, // user's ATA — tokens go here
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([keypair])
        .rpc();

      // Verify balances changed correctly:
      // User gained 500_000, PDA lost 500_000
      const userBalanceAfterDecrement = await connection.getTokenAccountBalance(
        userTokenAccount
      );
      const counterBalanceAfterDecrement =
        await connection.getTokenAccountBalance(counterPdaTokenAccount);

      assert.ok(
        Number(userBalanceAfterDecrement.value.amount) -
          Number(userBalanceBeforeDecrement.value.amount) ===
          decrementBy.toNumber()
      );

      assert.ok(
        Number(counterBalanceBeforeDecrement.value.amount) -
          Number(counterBalanceAfterDecrement.value.amount) ===
          decrementBy.toNumber()
      );
    }
  });
});

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

  // ============================================================
  // VAULT TESTS (Phase 2)
  // ============================================================
  // Same patterns as the counter tests above:
  // - createMint to deploy a token (like above)
  // - airdrop SOL to test keypairs (like above)
  // - createAssociatedTokenAccount for user ATAs (like above)
  // - mintTo to give users tokens (like above)
  // - PublicKey.findProgramAddressSync to derive PDAs (like counterPdaAddress above)
  // - program.methods.xxx().accountsStrict().signers().rpc() to call instructions (like above)
  // - program.account.xxx.fetch() to read on-chain state (like counter.fetch above)

  describe("Vault", () => {
    // Shared state across vault tests — these get set in "before" or early tests
    let mint: anchor.web3.PublicKey; // the underlying token (like USDC)
    let admin: Keypair; // vault admin keypair
    let user1: Keypair; // test depositor
    let user1TokenAccount: anchor.web3.PublicKey; // user1's ATA for the underlying token
    let vaultPda: anchor.web3.PublicKey; // vault state PDA
    let shareMintPda: anchor.web3.PublicKey; // share token mint PDA
    let reserveAta: anchor.web3.PublicKey; // vault's reserve ATA

    // Helper: airdrop SOL and confirm — same pattern as the counter test's airdrop block
    // The payer from Anchor's provider — used for fees throughout tests
    const payer = (provider.wallet as anchor.Wallet).payer;

    async function airdropAndConfirm(
      pubkey: anchor.web3.PublicKey,
      lamports: number
    ) {
      const sig = await connection.requestAirdrop(pubkey, lamports);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature: sig,
      });
    }

    // Helper: mint tokens and confirm — same pattern as the counter test's mintTo block
    async function mintTokensAndConfirm(
      tokenMint: anchor.web3.PublicKey,
      destination: anchor.web3.PublicKey,
      amount: number
    ) {
      const sig = await mintTo(
        connection,
        payer,
        tokenMint,
        destination,
        payer,
        amount
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature: sig,
      });
    }

    before(async () => {
      // Setup: same token creation pattern as the counter test
      admin = Keypair.generate();
      user1 = Keypair.generate();

      // Airdrop SOL — same as counter test line 49
      await airdropAndConfirm(admin.publicKey, 2e9);
      await airdropAndConfirm(user1.publicKey, 2e9);

      // Create underlying token mint (6 decimals, like USDC) — same as counter test line 65
      mint = await createMint(connection, payer, payer.publicKey, null, 6);

      // Create user1's ATA — same as counter test line 76
      user1TokenAccount = await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        user1.publicKey
      );

      // Mint 10.0 tokens to user1 — same as counter test line 87
      await mintTokensAndConfirm(mint, user1TokenAccount, 10_000_000);

      // Derive vault PDA — same pattern as counterPdaAddress derivation (line 121)
      // but with different seeds: ["vault", mint] instead of ["counter", signer]
      [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), mint.toBuffer()],
        program.programId
      );

      // Derive share mint PDA — seeds: ["shares", vault_state]
      [shareMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("shares"), vaultPda.toBuffer()],
        program.programId
      );

      // Derive reserve ATA — the vault PDA's token account for the underlying mint
      // This is the same concept as counterPdaTokenAccount (line 156) but for the vault
      reserveAta = anchor.utils.token.associatedAddress({
        mint: mint,
        owner: vaultPda,
      });
    });

    it("initialize_vault — creates vault, share mint, and reserve", async () => {
      // Call initialize_vault — same pattern as program.methods.initialize() (line 131)
      // but creates 3 accounts (vault_state + share_mint + reserve_ata) instead of 1
      const tx = await program.methods
        .initializeVault()
        .accountsStrict({
          admin: admin.publicKey,
          vaultState: vaultPda,
          tokenMint: mint,
          shareMint: shareMintPda,
          reserveAta: reserveAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      console.log("initialize_vault tx:", tx);

      // Fetch and verify vault state — same as program.account.counter.fetch() (line 146)
      const vault = await program.account.vaultState.fetch(vaultPda);

      console.log("Vault state:", vault);

      // Verify all fields were set correctly
      assert.ok(vault.admin.equals(admin.publicKey), "admin should match");
      assert.ok(
        vault.authority.equals(admin.publicKey),
        "authority should default to admin"
      );
      assert.ok(vault.tokenMint.equals(mint), "token_mint should match");
      assert.ok(
        vault.shareMint.equals(shareMintPda),
        "share_mint should match"
      );
      assert.ok(
        vault.totalDeposited.eq(new BN(0)),
        "total_deposited should be 0"
      );

      // Verify reserve ATA exists and has 0 balance
      const reserveBalance = await connection.getTokenAccountBalance(
        reserveAta
      );
      assert.ok(+reserveBalance.value.amount === 0, "reserve should be empty");

      console.log("Vault initialized successfully!");
    });

    it("deposit — first deposit gives 1:1 shares", async () => {
      const depositAmount = new BN(5_000_000); // 5.0 tokens

      // Derive user1's share ATA — will be created by init_if_needed in the instruction
      const user1ShareToken = anchor.utils.token.associatedAddress({
        mint: shareMintPda,
        owner: user1.publicKey,
      });

      // Call deposit — similar to increment (line 172) but also mints shares
      await program.methods
        .deposit(depositAmount)
        .accountsStrict({
          user: user1.publicKey,
          vaultState: vaultPda,
          tokenMint: mint,
          shareMint: shareMintPda,
          userTokenAccount: user1TokenAccount,
          reserveAta: reserveAta,
          userShareToken: user1ShareToken,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify vault state updated — same as fetching counter state after increment
      const vault = await program.account.vaultState.fetch(vaultPda);
      assert.ok(
        vault.totalDeposited.eq(depositAmount),
        "total_deposited should be 5M"
      );

      // Verify reserve received the tokens — same as checking counterBalanceAfter (line 199)
      const reserveBalance = await connection.getTokenAccountBalance(
        reserveAta
      );
      assert.ok(
        +reserveBalance.value.amount === depositAmount.toNumber(),
        "reserve should have 5M"
      );

      // Verify user received shares (1:1 for first deposit)
      const shareBalance = await connection.getTokenAccountBalance(
        user1ShareToken
      );
      assert.ok(
        +shareBalance.value.amount === depositAmount.toNumber(),
        "user should have 5M shares (1:1)"
      );

      // Verify user's token balance decreased
      const userBalance = await connection.getTokenAccountBalance(
        user1TokenAccount
      );
      assert.ok(
        +userBalance.value.amount === 10_000_000 - depositAmount.toNumber(),
        "user should have 5M tokens left"
      );

      console.log("First deposit: 5M tokens → 5M shares (1:1)");
    });

    it("deposit — second deposit gives proportional shares", async () => {
      const depositAmount = new BN(2_000_000); // 2.0 tokens

      const user1ShareToken = anchor.utils.token.associatedAddress({
        mint: shareMintPda,
        owner: user1.publicKey,
      });

      // Before: vault has 5M deposited, 5M shares. Ratio is 1:1.
      // Expected: 2M tokens * 5M shares / 5M deposited = 2M shares
      await program.methods
        .deposit(depositAmount)
        .accountsStrict({
          user: user1.publicKey,
          vaultState: vaultPda,
          tokenMint: mint,
          shareMint: shareMintPda,
          userTokenAccount: user1TokenAccount,
          reserveAta: reserveAta,
          userShareToken: user1ShareToken,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify totals
      const vault = await program.account.vaultState.fetch(vaultPda);
      assert.ok(
        vault.totalDeposited.eq(new BN(7_000_000)),
        "total_deposited should be 7M"
      );

      const reserveBalance = await connection.getTokenAccountBalance(
        reserveAta
      );
      assert.ok(
        +reserveBalance.value.amount === 7_000_000,
        "reserve should have 7M"
      );

      // User should have 5M + 2M = 7M shares total
      const shareBalance = await connection.getTokenAccountBalance(
        user1ShareToken
      );
      assert.ok(
        +shareBalance.value.amount === 7_000_000,
        "user should have 7M shares total"
      );

      console.log("Second deposit: 2M tokens → 2M shares (still 1:1 ratio)");
    });

    it("withdraw — burns shares and returns tokens", async () => {
      const sharesToBurn = new BN(3_000_000); // burn 3M shares

      const user1ShareToken = anchor.utils.token.associatedAddress({
        mint: shareMintPda,
        owner: user1.publicKey,
      });

      // Before: vault has 7M deposited, 7M shares. User has 7M shares.
      // Withdrawing 3M shares: underlying = 3M * 7M / 7M = 3M tokens
      const userBalanceBefore = await connection.getTokenAccountBalance(
        user1TokenAccount
      );

      // Call withdraw — similar to decrement (line 222) but also burns shares
      await program.methods
        .withdraw(sharesToBurn)
        .accountsStrict({
          user: user1.publicKey,
          vaultState: vaultPda,
          tokenMint: mint,
          shareMint: shareMintPda,
          userTokenAccount: user1TokenAccount,
          reserveAta: reserveAta,
          userShareToken: user1ShareToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify vault state
      const vault = await program.account.vaultState.fetch(vaultPda);
      assert.ok(
        vault.totalDeposited.eq(new BN(4_000_000)),
        "total_deposited should be 4M (7M - 3M)"
      );

      // Verify reserve decreased
      const reserveBalance = await connection.getTokenAccountBalance(
        reserveAta
      );
      assert.ok(
        +reserveBalance.value.amount === 4_000_000,
        "reserve should have 4M"
      );

      // Verify user got tokens back — same balance check pattern as decrement test (line 243)
      const userBalanceAfter = await connection.getTokenAccountBalance(
        user1TokenAccount
      );
      assert.ok(
        Number(userBalanceAfter.value.amount) -
          Number(userBalanceBefore.value.amount) ===
          sharesToBurn.toNumber(),
        "user should have received 3M tokens"
      );

      // Verify shares burned
      const shareBalance = await connection.getTokenAccountBalance(
        user1ShareToken
      );
      assert.ok(
        +shareBalance.value.amount === 4_000_000,
        "user should have 4M shares left (7M - 3M)"
      );

      console.log("Withdrew 3M shares → received 3M tokens");
    });

    it("withdraw — zero shares fails", async () => {
      const user1ShareToken = anchor.utils.token.associatedAddress({
        mint: shareMintPda,
        owner: user1.publicKey,
      });

      try {
        await program.methods
          .withdraw(new BN(0))
          .accountsStrict({
            user: user1.publicKey,
            vaultState: vaultPda,
            tokenMint: mint,
            shareMint: shareMintPda,
            userTokenAccount: user1TokenAccount,
            reserveAta: reserveAta,
            userShareToken: user1ShareToken,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown ZeroAmount error");
      } catch (err) {
        assert.ok(
          err.toString().includes("Amount must be greater than zero"),
          "should be ZeroAmount error"
        );
        console.log("Zero withdraw correctly rejected");
      }
    });

    it("withdraw — full withdrawal empties the vault", async () => {
      const user1ShareToken = anchor.utils.token.associatedAddress({
        mint: shareMintPda,
        owner: user1.publicKey,
      });

      // Burn all remaining 4M shares
      await program.methods
        .withdraw(new BN(4_000_000))
        .accountsStrict({
          user: user1.publicKey,
          vaultState: vaultPda,
          tokenMint: mint,
          shareMint: shareMintPda,
          userTokenAccount: user1TokenAccount,
          reserveAta: reserveAta,
          userShareToken: user1ShareToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Vault should be empty
      const vault = await program.account.vaultState.fetch(vaultPda);
      assert.ok(
        vault.totalDeposited.eq(new BN(0)),
        "total_deposited should be 0"
      );

      const reserveBalance = await connection.getTokenAccountBalance(
        reserveAta
      );
      assert.ok(+reserveBalance.value.amount === 0, "reserve should be empty");

      const shareBalance = await connection.getTokenAccountBalance(
        user1ShareToken
      );
      assert.ok(+shareBalance.value.amount === 0, "user should have 0 shares");

      // User should have all 10M tokens back
      const userBalance = await connection.getTokenAccountBalance(
        user1TokenAccount
      );
      assert.ok(
        +userBalance.value.amount === 10_000_000,
        "user should have all 10M tokens back"
      );

      console.log("Full withdrawal: vault empty, user has all tokens back");
    });
  });
});

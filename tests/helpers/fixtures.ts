// One-shot fixtures for the test suites in this directory. Each fixture
// initialises a fresh vault (with its own vault_id so PDAs don't collide
// across tests) on a new mint, optionally creates strategies, optionally
// pre-funds a depositor.
//
// Tests that mutate state should pick a unique `vaultId` to avoid colliding
// with other test files running in the same `anchor test` invocation.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { MyProject } from "../../target/types/my_project";

export interface VaultPdas {
  vaultState: PublicKey;
  vaultAuthority: PublicKey;
  shareMint: PublicKey;
  reserveAta: PublicKey;
}

export interface StrategyPdas {
  strategyId: number;
  strategy: PublicKey;
  strategyAuthority: PublicKey;
  strategyTokenAccount: PublicKey;
}

export function deriveVault(
  programId: PublicKey,
  tokenMint: PublicKey,
  vaultId: BN
): VaultPdas & { tokenMint: PublicKey } {
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
    programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultState.toBuffer()],
    programId
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultState.toBuffer()],
    programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({
    mint: tokenMint,
    owner: vaultAuthority,
  });
  return { vaultState, vaultAuthority, shareMint, reserveAta, tokenMint };
}

export function deriveStrategy(
  programId: PublicKey,
  vaultState: PublicKey,
  strategyId: number
): StrategyPdas {
  const [strategy] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultState.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  const [strategyAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), vaultState.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  const [strategyTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultState.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  return { strategyId, strategy, strategyAuthority, strategyTokenAccount };
}

export function deriveAllowedAction(
  programId: PublicKey,
  strategy: PublicKey,
  targetProgram: PublicKey,
  discriminator: number[] | Uint8Array
): PublicKey {
  const disc =
    discriminator instanceof Uint8Array ? Buffer.from(discriminator) : Buffer.from(discriminator);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_action"), strategy.toBuffer(), targetProgram.toBuffer(), disc],
    programId
  );
  return pda;
}

/**
 * Mint a fresh test token, init a vault, optionally create N strategies, and
 * (optionally) seed a user with `userMint` units of the underlying.
 */
export async function setupVault(opts: {
  program: Program<MyProject>;
  payer: Keypair;
  vaultId: number;
  decimals?: number;
  strategyCount?: number;
  userMintAmount?: number; // 0 = skip user setup
}): Promise<{
  mint: PublicKey;
  admin: Keypair;
  user: Keypair;
  userAta: PublicKey;
  vault: VaultPdas & { tokenMint: PublicKey };
  strategies: StrategyPdas[];
  delegates: Keypair[];
}> {
  const { program, payer, vaultId, decimals = 6, strategyCount = 0, userMintAmount = 0 } = opts;
  const provider = program.provider as anchor.AnchorProvider;
  const conn = provider.connection;

  // Admin = payer. (Test wallet doubles as the vault admin.)
  const admin = payer;

  const mint = await createMint(conn, payer, payer.publicKey, null, decimals);

  const vault = deriveVault(program.programId, mint, new BN(vaultId));

  await program.methods
    .initializeVault(new BN(vaultId))
    .accountsStrict({
      admin: admin.publicKey,
      vaultState: vault.vaultState,
      vaultAuthority: vault.vaultAuthority,
      tokenMint: mint,
      shareMint: vault.shareMint,
      reserveAta: vault.reserveAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  // Strategies + throwaway delegate keypairs
  const strategies: StrategyPdas[] = [];
  const delegates: Keypair[] = [];
  for (let i = 0; i < strategyCount; i++) {
    const s = deriveStrategy(program.programId, vault.vaultState, i);
    const delegate = Keypair.generate();
    delegates.push(delegate);

    // Pass any existing strategies as remaining_accounts so the program can
    // dedupe-check the new delegate.
    const existing = strategies.map((sp) => ({
      pubkey: sp.strategy,
      isSigner: false,
      isWritable: false,
    }));

    await program.methods
      .createStrategy()
      .accountsStrict({
        admin: admin.publicKey,
        vaultState: vault.vaultState,
        strategy: s.strategy,
        strategyAuthority: s.strategyAuthority,
        tokenMint: mint,
        strategyTokenAccount: s.strategyTokenAccount,
        delegate: delegate.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(existing)
      .rpc();

    strategies.push(s);
  }

  // User
  const user = Keypair.generate();
  await conn.confirmTransaction(
    await conn.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
  );
  const userAta = await createAssociatedTokenAccount(conn, payer, mint, user.publicKey);
  if (userMintAmount > 0) {
    await mintTo(conn, payer, mint, userAta, payer, userMintAmount);
  }

  return { mint, admin, user, userAta, vault, strategies, delegates };
}

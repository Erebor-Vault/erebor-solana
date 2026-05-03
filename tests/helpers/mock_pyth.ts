// Helper utilities for the mock_pyth program used by pyth_value_source.ts tests.
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import type { MockPyth } from "../../target/types/mock_pyth";

export function derivePriceFeedPda(
  programId: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("price"), mint.toBuffer()],
    programId,
  );
}

export async function initializeMockFeed(
  program: anchor.Program<MockPyth>,
  payer: anchor.web3.Keypair,
  mint: PublicKey,
  price: BN,
  expo: number,
): Promise<PublicKey> {
  const [feed] = derivePriceFeedPda(program.programId, mint);
  await program.methods
    .initializeFeed(price, expo)
    .accountsStrict({
      payer: payer.publicKey,
      mint,
      feed,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc();
  return feed;
}

export async function setMockPrice(
  program: anchor.Program<MockPyth>,
  payer: anchor.web3.Keypair,
  mint: PublicKey,
  price: BN,
  expo: number,
): Promise<void> {
  const [feed] = derivePriceFeedPda(program.programId, mint);
  await program.methods
    .setPrice(price, expo)
    .accountsStrict({
      payer: payer.publicKey,
      mint,
      feed,
    })
    .signers([payer])
    .rpc();
}

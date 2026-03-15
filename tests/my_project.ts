import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";

describe("my_project", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;
  const connection = provider.connection;

  const vaultAuthority = Keypair.generate();

  it("Is initialized!", async () => {
    // Add your test here.
    const keypair = Keypair.generate();

    const sig = await connection.requestAirdrop(keypair.publicKey, 1e9);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    await connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: sig,
    });

    const mint = await createMint(
      connection,
      provider.wallet.payer,
      provider.wallet.payer.publicKey,
      null,
      6
    );

    const sourceTokenAccount = await createAssociatedTokenAccount(
      connection,
      provider.wallet.payer,
      mint,
      keypair.publicKey
    );

    const destinationTokenAccount = await createAssociatedTokenAccount(
      connection,
      provider.wallet.payer,
      mint,
      vaultAuthority.publicKey
    );

    const amountToMint = 1_100_000;

    const mintSignature = await mintTo(
      connection,
      provider.wallet.payer,
      mint,
      sourceTokenAccount,
      provider.wallet.payer,
      amountToMint
    );

    {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();

      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature: mintSignature,
      });
    }

    const balance = await connection.getTokenAccountBalance(sourceTokenAccount);

    console.log(balance);

    assert.ok(+balance.value.amount === amountToMint);

    const [counterPdaAddress, counterBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), keypair.publicKey.toBuffer()],
      program.programId
    );
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        signer: keypair.publicKey,
        counter: counterPdaAddress,
        systemProgram: SystemProgram.programId,
      })
      .signers([keypair])
      .rpc();

    console.log("Your transaction signature", tx);

    const accountState = await program.account.counter.fetch(counterPdaAddress);
    console.log("Signer address", keypair.publicKey.toBase58());
    console.log(accountState);

    const incrementBy = new BN(2_000_000);
    await program.methods
      .increment(incrementBy)
      .accountsStrict({
        signer: keypair.publicKey,
        counter: counterPdaAddress,
        sourceTokenAccount,
        destinationTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        vaultAuthority: vaultAuthority.publicKey,
      })
      .signers([keypair])
      .rpc();

    const afterUpdate = await program.account.counter.fetch(counterPdaAddress);

    console.log("After update", afterUpdate);

    assert.ok(afterUpdate.value.eq(incrementBy));

    const sourceBalanceAfter = await connection.getTokenAccountBalance(
      sourceTokenAccount
    );
    const destinationBalanceAfter = await connection.getTokenAccountBalance(
      destinationTokenAccount
    );

    console.log(sourceBalanceAfter, destinationBalanceAfter);
  });
});

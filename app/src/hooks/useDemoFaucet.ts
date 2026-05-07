"use client";

import { useCallback, useState } from "react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { DEMO_FAUCET_PROGRAM_ID } from "@/lib/constants";
import idl from "@/idl/demo_faucet.json";

/**
 * Hook to call demo_faucet.claim for a given mint. Returns a `claim()`
 * function that builds + signs the tx with the connected wallet and
 * returns the signature.
 */
export function useDemoFaucet(mint: PublicKey) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState(false);

  const claim = useCallback(async (): Promise<string> => {
    if (!publicKey || !signTransaction) {
      throw new Error("Wallet not connected");
    }
    setBusy(true);
    try {
      const provider = new anchor.AnchorProvider(
        connection,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { publicKey, signTransaction, signAllTransactions: async (txs: any) => txs } as any,
        { commitment: "confirmed" }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const program = new anchor.Program(idl as any, provider) as anchor.Program<any>;

      const [faucetAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("faucet_authority"), mint.toBuffer()],
        DEMO_FAUCET_PROGRAM_ID
      );
      const [faucetConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("faucet_config"), mint.toBuffer()],
        DEMO_FAUCET_PROGRAM_ID
      );
      const [claimRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), mint.toBuffer(), publicKey.toBuffer()],
        DEMO_FAUCET_PROGRAM_ID
      );
      const recipientAta = PublicKey.findProgramAddressSync(
        [publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const sig = await program.methods
        .claim()
        .accountsStrict({
          recipient: publicKey,
          mint,
          faucetConfig,
          faucetAuthority,
          recipientAta,
          claimRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return sig;
    } finally {
      setBusy(false);
    }
  }, [connection, publicKey, signTransaction, mint]);

  return { claim, busy };
}

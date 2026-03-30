"use client";

import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL } from "@/lib/idl";
import { PROGRAM_ID } from "@/lib/constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VaultProgram = Program<any>;

/**
 * Returns an Anchor Program instance.
 * With a connected wallet: full provider (read + write).
 * Without a wallet: read-only provider (account fetches only).
 */
export function useVaultProgram(): VaultProgram {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (wallet) {
      const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Program(IDL as any, provider);
    }
    // Read-only: no wallet needed for fetching on-chain data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Program(IDL as any, { connection });
  }, [connection, wallet]);
}

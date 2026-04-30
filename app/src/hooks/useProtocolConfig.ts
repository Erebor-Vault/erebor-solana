"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { useVaultProgram } from "./useVaultProgram";
import { deriveProtocolConfigPda } from "@/lib/pda";

export interface ProtocolConfigData {
  pda: PublicKey;
  governance: PublicKey;
  treasury: PublicKey;
  protocolFeeBps: number;
  bump: number;
}

/** Fetches the global ProtocolConfig PDA. Returns null if it hasn't been
 *  initialised yet (i.e. before the deployer runs `initialize_protocol_config`). */
export function useProtocolConfig() {
  const program = useVaultProgram();
  const [config, setConfig] = useState<ProtocolConfigData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!program) {
      setLoading(false);
      return;
    }
    try {
      const pda = deriveProtocolConfigPda();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acct = await (program.account as any).protocolConfig.fetch(pda);
      setConfig({
        pda,
        governance: acct.governance,
        treasury: acct.treasury,
        protocolFeeBps: Number(acct.protocolFeeBps),
        bump: acct.bump,
      });
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [program]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, loading, refresh };
}

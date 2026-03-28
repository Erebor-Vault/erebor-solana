"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { VAULT_REGISTRY, type VaultEntry } from "@/lib/constants";
import { deriveVaultPda, deriveShareMintPda, deriveReserveAta } from "@/lib/pda";
import { useVaultProgram } from "@/hooks/useVaultProgram";

export interface VaultData {
  admin: PublicKey;
  authority: PublicKey;
  tokenMint: PublicKey;
  shareMint: PublicKey;
  totalDeposited: BN;
  strategyCount: BN;
  bump: number;
}

interface VaultContextValue {
  // Registry
  vaultEntries: VaultEntry[];
  activeEntry: VaultEntry;
  selectVault: (tokenMint: PublicKey) => void;
  // PDAs
  tokenMint: PublicKey;
  vaultPda: PublicKey;
  shareMintPda: PublicKey;
  reserveAta: PublicKey;
  // State
  vault: VaultData | null;
  shareSupply: BN;
  reserveBalance: BN;
  sharePrice: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}

const STORAGE_KEY = "sol-vault-selected-mint";

function getInitialEntry(): VaultEntry {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const found = VAULT_REGISTRY.find(
          (v) => v.tokenMint.toBase58() === saved
        );
        if (found) return found;
      }
    } catch {}
  }
  return VAULT_REGISTRY[0];
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const program = useVaultProgram();
  const [activeEntry, setActiveEntry] = useState<VaultEntry>(getInitialEntry);

  const tokenMint = activeEntry.tokenMint;
  const vaultPda = useMemo(() => deriveVaultPda(tokenMint, activeEntry.vaultId), [tokenMint, activeEntry.vaultId]);
  const shareMintPda = useMemo(() => deriveShareMintPda(vaultPda), [vaultPda]);
  const reserveAta = useMemo(
    () => deriveReserveAta(vaultPda, tokenMint),
    [vaultPda, tokenMint]
  );

  const [vault, setVault] = useState<VaultData | null>(null);
  const [shareSupply, setShareSupply] = useState(new BN(0));
  const [reserveBalance, setReserveBalance] = useState(new BN(0));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectVault = useCallback((mint: PublicKey) => {
    const entry = VAULT_REGISTRY.find(
      (v) => v.tokenMint.toBase58() === mint.toBase58()
    );
    if (entry) {
      setActiveEntry(entry);
      setVault(null);
      setLoading(true);
      setError(null);
      try {
        localStorage.setItem(STORAGE_KEY, mint.toBase58());
      } catch {}
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!program) return;
    try {
      const vaultAccount = await (program.account as any).vaultState.fetch(vaultPda);
      setVault(vaultAccount as unknown as VaultData);

      try {
        const supplyInfo = await connection.getTokenSupply(shareMintPda);
        setShareSupply(new BN(supplyInfo.value.amount));
      } catch {
        setShareSupply(new BN(0));
      }

      try {
        const reserveInfo = await connection.getTokenAccountBalance(reserveAta);
        setReserveBalance(new BN(reserveInfo.value.amount));
      } catch {
        setReserveBalance(new BN(0));
      }

      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch vault";
      if (message.includes("Account does not exist")) {
        setError("Vault not initialized for this token mint");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [program, connection, vaultPda, shareMintPda, reserveAta]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const sharePrice = useMemo(() => {
    if (!vault || shareSupply.isZero()) return 1;
    return vault.totalDeposited.toNumber() / shareSupply.toNumber();
  }, [vault, shareSupply]);

  const value: VaultContextValue = {
    vaultEntries: VAULT_REGISTRY,
    activeEntry,
    selectVault,
    tokenMint,
    vaultPda,
    shareMintPda,
    reserveAta,
    vault,
    shareSupply,
    reserveBalance,
    sharePrice,
    loading,
    error,
    refresh,
  };

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

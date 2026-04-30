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
import { usePathname, useRouter } from "next/navigation";
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
  vaultAuthorityBump: number;
  paused: boolean;
  performanceFeeBps: number;
  totalActiveWeightBps: number;
  /** Audit #21: pending two-step admin/authority transfers. `Pubkey::default()` (all zeros) means none. */
  pendingAdmin: PublicKey;
  pendingAuthority: PublicKey;
}

interface VaultContextValue {
  vaultEntries: VaultEntry[];
  activeEntry: VaultEntry;
  /** True only when the URL pinpoints a specific vault (`/vault/[address]`). */
  hasActiveVault: boolean;
  /**
   * Navigate to a vault's detail page. Kept named `selectVault` for
   * backwards-compat with existing callers; the implementation is now
   * `router.push`, not local state.
   */
  selectVault: (tokenMint: PublicKey, vaultId: number) => void;
  tokenMint: PublicKey;
  vaultPda: PublicKey;
  shareMintPda: PublicKey;
  reserveAta: PublicKey;
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

// PDA → entry lookup, built once at module load.
const ENTRY_BY_PDA: Map<string, VaultEntry> = (() => {
  const m = new Map<string, VaultEntry>();
  for (const e of VAULT_REGISTRY) {
    const pda = deriveVaultPda(e.tokenMint, e.vaultId).toBase58();
    m.set(pda, e);
  }
  return m;
})();

function entryFromPathname(pathname: string | null): VaultEntry | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/vault\/([^/]+)/);
  if (!m) return null;
  return ENTRY_BY_PDA.get(m[1]) ?? null;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const program = useVaultProgram();
  const pathname = usePathname();
  const router = useRouter();

  const urlEntry = useMemo(() => entryFromPathname(pathname), [pathname]);
  // Falls back to the first registry entry on non-vault pages so callers can
  // safely read `activeEntry` (e.g. for symbol metadata). `hasActiveVault`
  // is the truthy gate for "is this a per-vault page?".
  const activeEntry = urlEntry ?? VAULT_REGISTRY[0];
  const hasActiveVault = !!urlEntry;

  const tokenMint = activeEntry.tokenMint;
  const vaultPda = useMemo(
    () => deriveVaultPda(tokenMint, activeEntry.vaultId),
    [tokenMint, activeEntry.vaultId]
  );
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

  const vaultPdaKey = vaultPda.toBase58();

  // Reset cached state when the URL switches between vaults.
  useEffect(() => {
    setVault(null);
    setShareSupply(new BN(0));
    setReserveBalance(new BN(0));
    setLoading(true);
    setError(null);
  }, [vaultPdaKey]);

  const selectVault = useCallback(
    (mint: PublicKey, id: number) => {
      const entry = VAULT_REGISTRY.find(
        (v) => v.tokenMint.toBase58() === mint.toBase58() && v.vaultId === id
      );
      if (!entry) return;
      const targetPda = deriveVaultPda(entry.tokenMint, entry.vaultId).toBase58();
      // Preserve the sub-route (e.g. `/admin`) when switching between vaults.
      const sub = pathname?.match(/^\/vault\/[^/]+(\/.*)$/)?.[1] ?? "";
      router.push(`/vault/${targetPda}${sub}`);
    },
    [pathname, router]
  );

  const refresh = useCallback(async () => {
    if (!hasActiveVault) {
      setLoading(false);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }, [hasActiveVault, program, connection, vaultPda, shareMintPda, reserveAta]);

  useEffect(() => {
    refresh();
    if (!hasActiveVault) return;
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh, hasActiveVault]);

  const sharePrice = useMemo(() => {
    if (!vault || shareSupply.isZero()) return 1;
    return vault.totalDeposited.toNumber() / shareSupply.toNumber();
  }, [vault, shareSupply]);

  const value: VaultContextValue = {
    vaultEntries: VAULT_REGISTRY,
    activeEntry,
    hasActiveVault,
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

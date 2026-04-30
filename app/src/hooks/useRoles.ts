"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVault } from "@/components/providers/VaultProvider";

export interface RoleFlags {
  /** True when a wallet is connected. */
  connected: boolean;
  /** True when the connected wallet matches `vault_state.admin`. */
  isAdmin: boolean;
  /** True when the connected wallet matches `vault_state.authority`. */
  isAuthority: boolean;
  /** True while the vault state is still loading from RPC. */
  loading: boolean;
}

/**
 * Per-vault role flags for the connected wallet. Use these to drive the
 * disable-not-hide pattern: render every admin/authority control for everyone
 * but pass `disabled={!isAdmin}` / `disabled={!isAuthority}` so the UI is
 * self-documenting about who can do what.
 */
export function useRoles(): RoleFlags {
  const { publicKey, connected } = useWallet();
  const { vault, loading } = useVault();

  return useMemo<RoleFlags>(() => {
    if (!vault || !publicKey) {
      return { connected, isAdmin: false, isAuthority: false, loading };
    }
    return {
      connected,
      isAdmin: publicKey.equals(vault.admin),
      isAuthority: publicKey.equals(vault.authority),
      loading,
    };
  }, [vault, publicKey, connected, loading]);
}

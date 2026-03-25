"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useVault } from "@/components/providers/VaultProvider";
import { truncateAddress } from "@/lib/format";
import type { ReactNode } from "react";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { publicKey, connected } = useWallet();
  const { vault, loading } = useVault();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-10 text-center">
        <p className="text-lg text-[var(--color-text-secondary)]">
          Connect your wallet to access the admin panel
        </p>
      </div>
    );
  }

  if (!vault) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-danger)]/20 p-10 text-center">
        <p className="text-[var(--color-danger)]">Vault not initialized</p>
      </div>
    );
  }

  const isAdmin = publicKey?.equals(vault.admin);
  const isAuthority = publicKey?.equals(vault.authority);

  if (!isAdmin && !isAuthority) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-10 text-center">
        <p className="text-lg text-[var(--color-text-secondary)] mb-2">
          You are not the admin or authority of this vault
        </p>
        <p className="text-sm text-[var(--color-text-muted)]">
          Admin: {truncateAddress(vault.admin.toBase58())}
        </p>
        <p className="text-sm text-[var(--color-text-muted)]">
          Authority: {truncateAddress(vault.authority.toBase58())}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

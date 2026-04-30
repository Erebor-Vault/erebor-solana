"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { getCluster } from "@/lib/constants";
import { useVault } from "@/components/providers/VaultProvider";
import { useRoles } from "@/hooks/useRoles";
import { VaultSelector } from "./VaultSelector";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

export function Navbar() {
  const pathname = usePathname();
  const cluster = getCluster();
  const { hasActiveVault, vaultPda } = useVault();
  const roles = useRoles();
  const showAdminLink = hasActiveVault && (roles.isAdmin || roles.isAuthority);
  const adminHref = `/vault/${vaultPda.toBase58()}/admin`;
  const isOnAdmin = pathname?.endsWith("/admin");

  return (
    <nav className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface-secondary)]/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" className="text-xl font-bold tracking-tight text-[var(--color-accent)]">
            Erebor
          </Link>
          <div className="hidden gap-1 sm:flex">
            <Link
              href="/"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === "/"
                  ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Vaults
            </Link>
            {showAdminLink ? (
              <Link
                href={adminHref}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isOnAdmin
                    ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                Admin
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasActiveVault ? <VaultSelector /> : null}
          <span className="rounded-full bg-[var(--color-surface-hover)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
            {cluster === "devnet" ? "Devnet" : "Mainnet"}
          </span>
          <WalletMultiButton />
        </div>
      </div>
    </nav>
  );
}

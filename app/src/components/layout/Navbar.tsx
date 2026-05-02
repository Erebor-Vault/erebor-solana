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
      {/* Inscribed dot strip — picks up the deck's runic edge inscriptions
          without literal glyphs. Sits behind the navbar content. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent-secondary)]/35 to-transparent"
      />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            className="group flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight text-[var(--color-accent)]"
          >
            <VaultGlyph />
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
          <span className="rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            {cluster === "devnet" ? "Devnet" : "Mainnet"}
          </span>
          <WalletMultiButton />
        </div>
      </div>
    </nav>
  );
}

/** Hexagonal vault-door glyph — a stylized mountain peak / vault seal.
 *  Picks up the deck's "Erebor = lonely-mountain vault" identity in a
 *  shape that's at home in a sticky navbar. */
function VaultGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden
      className="text-[var(--color-accent)] transition-transform duration-300 group-hover:rotate-[8deg]"
    >
      <path
        d="M11 1 L20 6 L20 16 L11 21 L2 16 L2 6 Z"
        stroke="currentColor"
        strokeWidth="1.25"
        fill="none"
      />
      <path
        d="M11 5 L16.5 8.25 L16.5 13.75 L11 17 L5.5 13.75 L5.5 8.25 Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M11 5 L16.5 8.25 L16.5 13.75 L11 17 L5.5 13.75 L5.5 8.25 Z"
        stroke="currentColor"
        strokeWidth="0.9"
        fill="none"
      />
      <circle cx="11" cy="11" r="1.5" fill="currentColor" />
    </svg>
  );
}

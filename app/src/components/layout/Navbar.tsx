"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { getCluster } from "@/lib/constants";
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

  return (
    <nav className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold text-[var(--color-accent)]">
            Erebor
          </Link>
          <div className="flex gap-1">
            <Link
              href="/"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === "/"
                  ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/admin"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === "/admin"
                  ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Admin
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <VaultSelector />
          <span className="rounded-full bg-[var(--color-surface-hover)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
            {cluster === "devnet" ? "Devnet" : "Mainnet"}
          </span>
          <WalletMultiButton />
        </div>
      </div>
    </nav>
  );
}

"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useVault } from "@/components/providers/VaultProvider";
import { DEMO_ADMIN_WALLET_NAME } from "@/lib/demoAdminWalletAdapter";

/**
 * Shown only on vaults marked `demoVault: true` in the registry. Tells the
 * visitor they can grab admin powers by connecting the embedded "Demo
 * Admin" wallet adapter.
 */
export function DemoVaultBanner() {
  const { activeEntry } = useVault();
  const { wallet, select, connect, publicKey } = useWallet();
  const { setVisible } = useWalletModal();

  if (!activeEntry?.demoVault) return null;

  const onConnect = () => {
    if (wallet?.adapter.name === DEMO_ADMIN_WALLET_NAME) {
      connect().catch((e) => console.error("[demo-admin] connect failed:", e));
    } else {
      select(DEMO_ADMIN_WALLET_NAME);
      // wallet-adapter auto-connects after select when autoConnect=true.
      // If the user already had Phantom selected, surface the modal so they
      // can swap deliberately.
      setVisible(true);
    }
  };

  const isDemoConnected =
    wallet?.adapter.name === DEMO_ADMIN_WALLET_NAME && !!publicKey;

  return (
    <aside
      role="note"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-accent-secondary)]/40 bg-[var(--color-accent-secondary)]/10 px-4 py-3 text-sm"
    >
      <span aria-hidden className="text-base">🎮</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--color-text-primary)]">
          Demo vault — anyone can act as admin
        </p>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {isDemoConnected
            ? "You're signed in as Demo Admin. Try toggling allow-list tokens, creating strategies, or settling."
            : "Connect the “Demo Admin (devnet)” wallet to manage strategies, allow-listed tokens, and fees."}
        </p>
      </div>
      {!isDemoConnected ? (
        <button
          type="button"
          onClick={onConnect}
          className="shrink-0 rounded-md bg-[var(--color-accent-secondary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-secondary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-secondary)]"
        >
          Connect demo admin
        </button>
      ) : null}
    </aside>
  );
}

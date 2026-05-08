"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVault } from "@/components/providers/VaultProvider";
import { DEMO_ADMIN_WALLET_NAME } from "@/lib/demoAdminWalletAdapter";

/**
 * Shown only on vaults marked `demoVault: true` in the registry. Tells the
 * visitor they can grab admin powers by connecting the embedded "Demo
 * Admin" wallet adapter.
 */
export function DemoVaultBanner() {
  const { activeEntry } = useVault();
  const { wallet, wallets, select, connect, disconnect, publicKey, connecting } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adapter availability — set at build time via NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58.
  const adapterRegistered = wallets.some(
    (w) => w.adapter.name === DEMO_ADMIN_WALLET_NAME,
  );
  // When the user clicks the button while another wallet is selected we
  // disconnect → select(demo). The actual connect() must wait until
  // wallet-adapter has swapped `wallet` to the demo adapter, otherwise
  // we'd call connect() on the still-mounted Phantom adapter. Track the
  // pending request and fire connect() from an effect that watches `wallet`.
  const pendingDemoConnect = useRef(false);

  useEffect(() => {
    if (!pendingDemoConnect.current) return;
    if (wallet?.adapter.name !== DEMO_ADMIN_WALLET_NAME) return;
    pendingDemoConnect.current = false;
    connect()
      .catch((e) => console.error("[demo-admin] connect failed:", e))
      .finally(() => setBusy(false));
  }, [wallet, connect]);

  if (!activeEntry?.demoVault) return null;

  const onConnect = async () => {
    if (!adapterRegistered) {
      setError(
        "Demo admin wallet adapter is not registered — the deployment is missing NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    // Safety net: if `select()` somehow doesn't propagate within 8s, unstick.
    const timer = setTimeout(() => {
      if (pendingDemoConnect.current) {
        pendingDemoConnect.current = false;
        setBusy(false);
        setError("Wallet did not switch. Reload the page and try again.");
      }
    }, 8000);
    try {
      const isAlreadyDemo = wallet?.adapter.name === DEMO_ADMIN_WALLET_NAME;
      if (isAlreadyDemo) {
        if (!publicKey) await connect();
      } else {
        // Different wallet (Phantom/Solflare/none) — drop it first so
        // wallet-adapter's autoConnect doesn't race the select() call.
        if (wallet) {
          try {
            await disconnect();
          } catch {
            /* swallow — already disconnected */
          }
        }
        pendingDemoConnect.current = true;
        select(DEMO_ADMIN_WALLET_NAME);
      }
    } catch (e) {
      console.error("[demo-admin] swap failed:", e);
      setError((e as Error).message ?? "Failed to switch wallet.");
      setBusy(false);
    } finally {
      // setBusy(false) handled by the effect once connect resolves;
      // only release here if we never queued a pending swap.
      if (!pendingDemoConnect.current) {
        clearTimeout(timer);
        setBusy(false);
      }
    }
  };

  const isDemoConnected =
    wallet?.adapter.name === DEMO_ADMIN_WALLET_NAME && !!publicKey;
  const buttonLabel = busy || connecting
    ? "Switching…"
    : wallet && wallet.adapter.name !== DEMO_ADMIN_WALLET_NAME
      ? `Switch to demo admin`
      : "Connect demo admin";

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
        {error ? (
          <p
            role="alert"
            className="mt-1 text-xs text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}
      </div>
      {!isDemoConnected ? (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy || connecting}
          className="shrink-0 rounded-md bg-[var(--color-accent-secondary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-secondary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-secondary)]"
        >
          {buttonLabel}
        </button>
      ) : null}
    </aside>
  );
}

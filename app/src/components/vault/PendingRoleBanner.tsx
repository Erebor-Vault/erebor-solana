"use client";

import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVault } from "@/components/providers/VaultProvider";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

/** Surfaces the two-step admin/authority transfer Accept buttons on the
 *  regular vault page so the pending recipient doesn't need to discover
 *  the /admin sub-route. Renders only when the connected wallet matches
 *  vault.pending_admin or vault.pending_authority. */
export function PendingRoleBanner() {
  const { vault } = useVault();
  const { publicKey } = useWallet();
  const { acceptAdmin, acceptAuthority, loading } = useAdminActions();

  if (!vault || !publicKey) return null;

  const isPendingAdmin =
    !vault.pendingAdmin.equals(PublicKey.default) &&
    publicKey.equals(vault.pendingAdmin);
  const isPendingAuthority =
    !vault.pendingAuthority.equals(PublicKey.default) &&
    publicKey.equals(vault.pendingAuthority);

  if (!isPendingAdmin && !isPendingAuthority) return null;

  async function onAcceptAdmin() {
    try {
      const sig = await acceptAdmin();
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    }
  }

  async function onAcceptAuthority() {
    try {
      const sig = await acceptAuthority();
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-warning)]">
            Pending role transfer
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            The current admin proposed transferring
            {isPendingAdmin && isPendingAuthority
              ? " admin and authority "
              : isPendingAdmin
                ? " the admin role "
                : " the authority role "}
            to this wallet. Until you accept, the role does not move.
          </p>
        </div>
        <div className="flex gap-2">
          {isPendingAdmin && (
            <button
              onClick={onAcceptAdmin}
              disabled={loading}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Accepting…" : "Accept admin"}
            </button>
          )}
          {isPendingAuthority && (
            <button
              onClick={onAcceptAuthority}
              disabled={loading}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Accepting…" : "Accept authority"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

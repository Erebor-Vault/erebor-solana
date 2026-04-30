"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVault } from "@/components/providers/VaultProvider";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";

/** Two-step admin / authority transfer flow (audit #21). The current admin
 *  proposes a new pubkey via `propose_admin` / `propose_authority`; the
 *  pending recipient must call `accept_admin` / `accept_authority` from their
 *  own wallet to finalise. */
export function AdminTransferFlow() {
  const { vault } = useVault();
  const wallet = useWallet();
  const {
    proposeAdmin,
    acceptAdmin,
    proposeAuthority,
    acceptAuthority,
    loading,
  } = useAdminActions();

  const [adminInput, setAdminInput] = useState("");
  const [authorityInput, setAuthorityInput] = useState("");

  if (!vault) return null;

  const isCurrentAdmin =
    !!wallet.publicKey && wallet.publicKey.equals(vault.admin);
  const pendingAdmin = vault.pendingAdmin;
  const pendingAuthority = vault.pendingAuthority;
  const isPendingAdmin =
    !!wallet.publicKey &&
    !pendingAdmin.equals(PublicKey.default) &&
    wallet.publicKey.equals(pendingAdmin);
  const isPendingAuthority =
    !!wallet.publicKey &&
    !pendingAuthority.equals(PublicKey.default) &&
    wallet.publicKey.equals(pendingAuthority);

  function tryParse(input: string): PublicKey | null {
    try {
      return new PublicKey(input.trim());
    } catch {
      return null;
    }
  }

  async function onProposeAdmin() {
    const pk = tryParse(adminInput);
    if (!pk) {
      showTxError(new Error("Invalid pubkey"));
      return;
    }
    try {
      const sig = await proposeAdmin(pk);
      showTxSuccess(sig);
      setAdminInput("");
    } catch (err) {
      showTxError(err);
    }
  }

  async function onProposeAuthority() {
    const pk = tryParse(authorityInput);
    if (!pk) {
      showTxError(new Error("Invalid pubkey"));
      return;
    }
    try {
      const sig = await proposeAuthority(pk);
      showTxSuccess(sig);
      setAuthorityInput("");
    } catch (err) {
      showTxError(err);
    }
  }

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
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-3">
        <h3 className="text-base font-semibold">Admin & authority transfer</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Two-step propose / accept. Until the recipient accepts from their own
          wallet, the role does not move.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <RoleColumn
          title="Admin"
          current={vault.admin}
          pending={pendingAdmin}
          isCurrent={isCurrentAdmin}
          isPending={isPendingAdmin}
          input={adminInput}
          setInput={setAdminInput}
          onPropose={onProposeAdmin}
          onAccept={onAcceptAdmin}
          loading={loading}
        />
        <RoleColumn
          title="Authority"
          current={vault.authority}
          pending={pendingAuthority}
          isCurrent={isCurrentAdmin}
          isPending={isPendingAuthority}
          input={authorityInput}
          setInput={setAuthorityInput}
          onPropose={onProposeAuthority}
          onAccept={onAcceptAuthority}
          loading={loading}
        />
      </div>
    </section>
  );
}

function RoleColumn(props: {
  title: string;
  current: PublicKey;
  pending: PublicKey;
  isCurrent: boolean;
  isPending: boolean;
  input: string;
  setInput: (v: string) => void;
  onPropose: () => void;
  onAccept: () => void;
  loading: boolean;
}) {
  const hasPending = !props.pending.equals(PublicKey.default);
  return (
    <div className="rounded-md border border-[var(--color-border)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {props.title}
      </div>
      <div className="mt-1 font-mono text-xs">
        {truncateAddress(props.current.toBase58(), 6)}
      </div>
      {hasPending && (
        <div className="mt-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2 text-xs">
          Pending: {truncateAddress(props.pending.toBase58(), 6)}
          {props.isPending && (
            <button
              onClick={props.onAccept}
              disabled={props.loading}
              className="ml-3 rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-semibold text-black disabled:opacity-50"
            >
              Accept
            </button>
          )}
        </div>
      )}
      {props.isCurrent && (
        <div className="mt-3 grid gap-2">
          <input
            type="text"
            value={props.input}
            onChange={(e) => props.setInput(e.target.value)}
            placeholder="New pubkey…"
            spellCheck={false}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs outline-none"
          />
          <button
            onClick={props.onPropose}
            disabled={props.loading || props.input.trim() === ""}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:border-[var(--color-accent)]/60 disabled:opacity-50"
          >
            Propose
          </button>
        </div>
      )}
    </div>
  );
}

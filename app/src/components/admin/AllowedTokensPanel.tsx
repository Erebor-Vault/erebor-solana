"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAllowedTokens } from "@/hooks/useAllowedTokens";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { CopyButton } from "@/components/shared/CopyButton";
import { truncateAddress } from "@/lib/format";

/** Protocol-level token allow-list manager. Lists every `AllowedToken` PDA
 *  and lets the governance signer add or remove mints. Visible to all on
 *  the admin page, but the add/remove buttons are gated by
 *  ProtocolConfig.governance — non-governance wallets see a read-only list. */
export function AllowedTokensPanel() {
  const { rows, loading, isGovernance, addAllowed, removeAllowed } = useAllowedTokens();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function tryParse(s: string): PublicKey | null {
    try {
      return new PublicKey(s.trim());
    } catch {
      return null;
    }
  }

  async function onAdd() {
    const pk = tryParse(input);
    if (!pk) {
      showTxError(new Error("Invalid mint pubkey"));
      return;
    }
    setBusy(pk.toBase58());
    try {
      const sig = await addAllowed(pk);
      showTxSuccess(sig);
      setInput("");
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(mint: PublicKey) {
    setBusy(mint.toBase58());
    try {
      const sig = await removeAllowed(mint);
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-3">
        <h3 className="text-base font-semibold">Token allow-list (protocol-wide)</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Mints listed here are the only valid <em>output</em> tokens for
          swap-style actions (Jupiter route, Drift swap, …). When an
          AllowedAction declares an <code>output_mint_index</code>, the
          program checks the mint at that slot is in this list and reverts
          otherwise. Governance-only.
        </p>
      </header>

      {isGovernance ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Mint address (base58)…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={onAdd}
            disabled={busy !== null || input.trim() === ""}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            Add
          </button>
        </div>
      ) : (
        <p className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs text-[var(--color-text-muted)]">
          Read-only — only the protocol governance signer can add or remove
          mints.
        </p>
      )}

      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Allowed mints ({rows.length})
        </p>
        {loading ? (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            No tokens whitelisted yet. Until at least the underlying USDC
            mint is added, swap-style actions will revert.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {rows.map((r) => {
              const mintStr = r.mint.toBase58();
              return (
                <li
                  key={mintStr}
                  className="flex items-center justify-between gap-3 py-2 font-mono text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    <span title={mintStr}>{truncateAddress(mintStr, 8)}</span>
                    <CopyButton value={mintStr} ariaLabel="Copy mint" />
                  </span>
                  {isGovernance ? (
                    <button
                      onClick={() => onRemove(r.mint)}
                      disabled={busy !== null}
                      className="rounded-md bg-[var(--color-danger)]/15 px-3 py-1 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 disabled:opacity-50"
                    >
                      {busy === mintStr ? "Removing…" : "Remove"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

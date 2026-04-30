"use client";

import { useEffect, useState } from "react";
import { Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import type { StrategyData } from "@/hooks/useStrategies";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { ADAPTERS, type ProtocolPosition, type RedeemAdapter } from "@/lib/adapters";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

interface Props {
  strategy: StrategyData;
  decimals: number;
}

interface DiscoveredPosition {
  adapter: RedeemAdapter;
  position: ProtocolPosition;
}

/** Per-strategy "redeem from external protocol" panel.
 *
 *  Queries every registered adapter for an open position on this strategy.
 *  Shows what's redeemable and lets the admin / authority click to dispatch
 *  `execute_action(<adapter target>, <withdraw discriminator>)` and pull the
 *  funds back into the strategy ATA. After that, regular `deallocate_from_strategy`
 *  or a withdraw triggers the in-ATA auto-pull (Phase 4b).
 */
export function RedeemFromExternalButton({ strategy, decimals }: Props) {
  const program = useVaultProgram();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { vault, vaultPda, tokenMint } = useVault();

  const [positions, setPositions] = useState<DiscoveredPosition[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Re-scan whenever the strategy changes.
  useEffect(() => {
    let cancelled = false;
    async function scan() {
      if (!vaultPda || !tokenMint) return;
      setScanLoading(true);
      const found: DiscoveredPosition[] = [];
      for (const adapter of ADAPTERS) {
        try {
          const position = await adapter.readPosition({
            connection,
            vaultPda,
            strategy,
            underlyingMint: tokenMint,
          });
          if (position && position.underlyingAvailable.gtn(0)) {
            found.push({ adapter, position });
          }
        } catch {
          /* adapter unavailable, skip */
        }
      }
      if (!cancelled) {
        setPositions(found);
        setScanLoading(false);
      }
    }
    void scan();
    return () => {
      cancelled = true;
    };
  }, [strategy, connection, vaultPda, tokenMint]);

  if (!program || !publicKey || !vault) return null;
  const isAuthorityOrAdmin =
    publicKey.equals(vault.admin) || publicKey.equals(vault.authority);
  if (!isAuthorityOrAdmin) return null;

  if (scanLoading && positions.length === 0) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 text-xs text-[var(--color-text-muted)]">
        Scanning external positions…
      </div>
    );
  }
  if (positions.length === 0) return null;

  async function onRedeem(found: DiscoveredPosition) {
    if (!program || !publicKey) return;
    setBusy(found.adapter.id);
    try {
      const ix = await found.adapter.buildRedeemAction({
        connection,
        program,
        caller: publicKey,
        vaultPda: vaultPda!,
        strategy,
        underlyingMint: tokenMint!,
        underlyingAmount: found.position.underlyingAvailable,
      });
      const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const tx = new Transaction().add(computeIx, ix);
      const sig = await program.provider.sendAndConfirm!(tx);
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
        <h3 className="text-base font-semibold">Redeem from external protocol</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Brings funds parked in external protocols (Kamino, Drift, …) back
          into this strategy&apos;s ATA. Uses <code>execute_action</code> with
          the corresponding whitelisted withdraw discriminator. Required
          before a regular <code>withdraw</code> can sweep funds from a
          strategy that has externally-deployed positions.
        </p>
      </header>
      <ul className="space-y-2">
        {positions.map(({ adapter, position }) => {
          const display = (
            position.underlyingAvailable.toNumber() / Math.pow(10, decimals)
          ).toFixed(decimals === 6 ? 6 : 4);
          return (
            <li
              key={adapter.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{position.label}</div>
                <div className="font-mono text-xs text-[var(--color-text-muted)]">
                  redeemable: {display}
                </div>
              </div>
              <button
                onClick={() => onRedeem({ adapter, position })}
                disabled={busy !== null}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
              >
                {busy === adapter.id ? "Redeeming…" : "Redeem"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

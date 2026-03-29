"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

const CHECKLIST = [
  { item: "Agent trustworthiness", owner: "Admin/Curator (this checklist)", shipped: false },
  { item: "Agent track record", owner: "Admin/Curator (this checklist)", shipped: false },
  { item: "Agent key security", owner: "Admin/Curator (this checklist)", shipped: false },
  { item: "Choosing allocation weights", owner: "Admin/Curator (set_strategy_weight)", shipped: true },
  { item: "Continuous monitoring", owner: "Admin/Curator (ongoing responsibility)", shipped: false },
  { item: "Token/protocol allowlists", owner: "Admin/Curator (manual review — on-chain enforcement planned)", shipped: false },
  { item: "Velocity limits enforcement", owner: "Admin/Curator (manual monitoring — on-chain limits planned)", shipped: false },
  { item: "Agent access isolation", owner: "Vault (Anchor constraints)", shipped: true },
  { item: "Proportional allocations & rebalancing", owner: "Vault (on-chain)", shipped: true },
  { item: "PDA ownership of all accounts", owner: "Vault (on-chain)", shipped: true },
];

interface Props {
  onCreated: () => Promise<void>;
}

export function CreateStrategyForm({ onCreated }: Props) {
  const { createStrategy, loading } = useAdminActions();
  const [delegate, setDelegate] = useState("");
  const [open, setOpen] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  const handleCreate = async () => {
    try {
      const delegatePubkey = new PublicKey(delegate);
      const sig = await createStrategy(delegatePubkey);
      showTxSuccess(sig);
      setDelegate("");
      setOpen(false);
      await onCreated();
    } catch (err) {
      showTxError(err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setShowChecklist(!showChecklist)}
          className="rounded-lg bg-[var(--color-surface-hover)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {showChecklist ? "Hide Checklist" : "Safety Checklist"}
        </button>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#12d985]"
          >
            + Create Strategy
          </button>
        )}
      </div>

      {open && (
        <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5 space-y-4">
          <h3 className="font-medium">Create New Strategy</h3>
          <div>
            <label className="text-sm text-[var(--color-text-secondary)]">
              Delegate Address
            </label>
            <input
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              placeholder="Protocol public key..."
              className="mt-1 w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={loading || !delegate}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg bg-[var(--color-surface-hover)] px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showChecklist && <AgentSafetyChecklist />}
    </div>
  );
}

function AgentSafetyChecklist() {
  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5 space-y-4">
      <h3 className="font-medium">Agent Safety Checklist</h3>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Review before adding a new agent delegate
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--color-text-muted)]">
            <th className="pb-2 font-medium">Responsibility</th>
            <th className="pb-2 font-medium">Who handles it</th>
            <th className="pb-2 font-medium text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {CHECKLIST.map((row) => (
            <tr key={row.item}>
              <td className="py-2 pr-3">{row.item}</td>
              <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                {row.owner}
              </td>
              <td className="py-2 text-center">
                {row.shipped ? (
                  <span className="text-[var(--color-success)]" title="Shipped">&#10003;</span>
                ) : (
                  <span className="text-[var(--color-warning)]" title="Planned / Manual">&#9675;</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-3 text-xs text-[var(--color-text-secondary)] space-y-2">
        <p>
          <strong className="text-[var(--color-text-primary)]">Key principle:</strong>{" "}
          The vault cannot cryptographically guarantee agent behavior.
          The vault limits the blast radius (max loss = one strategy&apos;s allocation).
        </p>
        <p>
          The admin/curator is responsible for choosing reliable agents that comply with safety rules.
          This removes the burden of per-agent research from every individual user.
        </p>
      </div>
    </div>
  );
}

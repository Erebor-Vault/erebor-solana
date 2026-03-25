"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

interface Props {
  onCreated: () => Promise<void>;
}

export function CreateStrategyForm({ onCreated }: Props) {
  const { createStrategy, loading } = useAdminActions();
  const [delegate, setDelegate] = useState("");
  const [open, setOpen] = useState(false);

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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#12d985]"
      >
        + Create Strategy
      </button>
    );
  }

  return (
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
  );
}

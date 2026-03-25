"use client";

import toast from "react-hot-toast";
import { getExplorerUrl } from "@/lib/constants";
import { truncateAddress } from "@/lib/format";

export function showTxSuccess(signature: string) {
  toast.success(
    (t) => (
      <div className="flex flex-col gap-1">
        <span className="font-medium">Transaction confirmed</span>
        <a
          href={getExplorerUrl(signature, "tx")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--color-accent)] hover:underline"
          onClick={() => toast.dismiss(t.id)}
        >
          {truncateAddress(signature, 8)} ↗
        </a>
      </div>
    ),
    { duration: 6000 }
  );
}

export function showTxError(error: unknown) {
  let message = "Transaction failed";
  if (error instanceof Error) {
    // Parse Anchor error messages
    const match = error.message.match(/Error Message: (.+)/);
    if (match) {
      message = match[1];
    } else if (error.message.includes("User rejected")) {
      message = "Transaction rejected by wallet";
    } else {
      message = error.message.slice(0, 100);
    }
  }
  toast.error(message, { duration: 5000 });
}

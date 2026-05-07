"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { getRpcUrl } from "@/lib/constants";
import { E2ETestWalletAdapter, E2E_TEST_WALLET_NAME } from "@/lib/testWalletAdapter";
import { DemoAdminWalletAdapter } from "@/lib/demoAdminWalletAdapter";

const E2E_ENABLED = process.env.NEXT_PUBLIC_E2E === "1";
const DEMO_ADMIN_ENABLED = !!process.env.NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58;

function E2EAutoSelect() {
  const { select, wallet, connect, connected, connecting } = useWallet();
  useEffect(() => {
    if (!wallet) {
      select(E2E_TEST_WALLET_NAME);
      return;
    }
    if (wallet.adapter.name === E2E_TEST_WALLET_NAME && !connected && !connecting) {
      connect().catch((e) => console.error("[E2E] connect failed:", e));
    }
  }, [wallet, connected, connecting, select, connect]);
  return null;
}

export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => getRpcUrl(), []);
  const wallets = useMemo<Adapter[]>(() => {
    const list: Adapter[] = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
    if (E2E_ENABLED) list.unshift(new E2ETestWalletAdapter());
    if (DEMO_ADMIN_ENABLED) list.unshift(new DemoAdminWalletAdapter());
    return list;
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect
        onError={(e) => console.error("[wallet-adapter onError]", e)}
      >
        <WalletModalProvider>
          {E2E_ENABLED ? <E2EAutoSelect /> : null}
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

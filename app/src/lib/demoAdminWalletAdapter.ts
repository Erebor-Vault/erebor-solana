/**
 * Demo-admin wallet adapter. Loads a fixed keypair from
 * `NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58` (the admin + authority of the
 * vault marked `demoVault: true` in the registry). Selectable from the
 * "Connect Wallet" modal whenever the env var is present.
 *
 * **Devnet only.** The bs58 secret ships in the public bundle by design —
 * anyone can sign as the demo admin, which is the entire point. Never
 * use this adapter against mainnet.
 */
import {
  BaseSignerWalletAdapter,
  WalletReadyState,
  WalletName,
  WalletNotConnectedError,
} from "@solana/wallet-adapter-base";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

export const DEMO_ADMIN_WALLET_NAME =
  "Demo Admin (devnet)" as WalletName<"Demo Admin (devnet)">;

export class DemoAdminWalletAdapter extends BaseSignerWalletAdapter {
  name = DEMO_ADMIN_WALLET_NAME;
  url = "https://example.invalid/demo-admin";
  // Small inline SVG with the letters "DA" — purple background to match the
  // demo banner. Keeps wallet-adapter happy without an extra asset fetch.
  icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyNCcgaGVpZ2h0PScyNCc+PHJlY3Qgd2lkdGg9JzI0JyBoZWlnaHQ9JzI0JyByeD0nNCcgZmlsbD0nIzhiNWNmNicvPjx0ZXh0IHg9JzEyJyB5PScxNicgZm9udC1zaXplPScxMScgZm9udC1mYW1pbHk9J3NhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9JyNmZmYnPkRBPC90ZXh0Pjwvc3ZnPg==";
  readyState = WalletReadyState.Loadable;
  supportedTransactionVersions = new Set(["legacy", 0] as const);

  private _keypair: Keypair | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  get publicKey() {
    return this._publicKey;
  }
  get connecting() {
    return this._connecting;
  }

  private loadKeypair(): Keypair {
    if (this._keypair) return this._keypair;
    const bs58Secret = process.env.NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58;
    if (!bs58Secret) {
      throw new Error(
        "Demo admin wallet: NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58 is not set",
      );
    }
    this._keypair = Keypair.fromSecretKey(bs58.decode(bs58Secret));
    return this._keypair;
  }

  async connect(): Promise<void> {
    if (this._publicKey) return;
    this._connecting = true;
    try {
      const kp = this.loadKeypair();
      this._publicKey = kp.publicKey;
      const pk = this._publicKey;
      setTimeout(() => this.emit("connect", pk), 0);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    this._keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const kp = this._keypair ?? this.loadKeypair();
    if (!this._publicKey) throw new WalletNotConnectedError();
    if ("version" in tx) tx.sign([kp]);
    else (tx as Transaction).partialSign(kp);
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

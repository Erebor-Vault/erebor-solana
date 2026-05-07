/**
 * E2E test wallet adapter. Loads a keypair from
 * `NEXT_PUBLIC_E2E_KEYPAIR_BS58` and signs txs in-process. Only wired into
 * `SolanaProvider` when `NEXT_PUBLIC_E2E === "1"`. Never use in production.
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

export const E2E_TEST_WALLET_NAME = "E2E Test Wallet" as WalletName<"E2E Test Wallet">;

export class E2ETestWalletAdapter extends BaseSignerWalletAdapter {
  name = E2E_TEST_WALLET_NAME;
  url = "https://example.invalid/e2e";
  icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyNCcgaGVpZ2h0PScyNCc+PHJlY3Qgd2lkdGg9JzI0JyBoZWlnaHQ9JzI0JyBmaWxsPScjZjA1Jy8+PHRleHQgeD0nMTInIHk9JzE2JyBmb250LXNpemU9JzEyJyB0ZXh0LWFuY2hvcj0nbWlkZGxlJyBmaWxsPScjZmZmJz5FMkU8L3RleHQ+PC9zdmc+";
  readyState = WalletReadyState.Loadable;
  supportedTransactionVersions = new Set(["legacy", 0] as const);

  private _keypair: Keypair | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  constructor() {
    super();
  }

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  private loadKeypair(): Keypair {
    if (this._keypair) return this._keypair;
    const bs58Secret = process.env.NEXT_PUBLIC_E2E_KEYPAIR_BS58;
    console.log("[E2E adapter] loadKeypair, bs58Secret length:", bs58Secret?.length ?? 0);
    if (!bs58Secret) {
      throw new Error(
        "E2E wallet: NEXT_PUBLIC_E2E_KEYPAIR_BS58 is not set",
      );
    }
    const sk = bs58.decode(bs58Secret);
    this._keypair = Keypair.fromSecretKey(sk);
    return this._keypair;
  }

  async connect(): Promise<void> {
    console.log("[E2E adapter] connect() called");
    if (this._publicKey) {
      console.log("[E2E adapter] already connected");
      return;
    }
    this._connecting = true;
    try {
      const kp = this.loadKeypair();
      this._publicKey = kp.publicKey;
      console.log("[E2E adapter] connected as", kp.publicKey.toBase58());
      // Defer emit so any listener registered in a later useEffect tick
      // still receives it. Real wallet adapters are async (waiting on
      // user approval) so the framework doesn't trip on synchronous emits.
      const pk = this._publicKey;
      setTimeout(() => this.emit("connect", pk), 0);
    } catch (e) {
      console.error("[E2E adapter] connect failed:", e);
      throw e;
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
    if ("version" in tx) {
      tx.sign([kp]);
    } else {
      (tx as Transaction).partialSign(kp);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }

}

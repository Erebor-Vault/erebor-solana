/**
 * check-mock-feeds.ts — List protocol-level AllowedToken mints, derive their
 * mock-Pyth feed PDAs, and report whether each feed account is initialized.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const conn = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(loadWallet(WALLET_PATH));
  anchor.setProvider(new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" }));
  const program = anchor.workspace.myProject as Program<MyProject>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = await (program.account as any).allowedToken.all();
  console.log(`AllowedToken entries: ${all.length}\n`);
  for (const r of all) {
    const mint = r.account.mint as PublicKey;
    const [feed] = PublicKey.findProgramAddressSync(
      [Buffer.from("price"), mint.toBuffer()],
      MOCK_PYTH,
    );
    const info = await conn.getAccountInfo(feed);
    console.log(`mint ${mint.toBase58()}`);
    console.log(`  feed PDA: ${feed.toBase58()}`);
    console.log(`  exists:   ${info ? `yes (${info.data.length} bytes, owner ${info.owner.toBase58()})` : "NO"}\n`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

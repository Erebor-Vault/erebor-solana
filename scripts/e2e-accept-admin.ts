/**
 * Finalize admin + authority transfer to the E2E test wallet for the
 * vault created by mint-to-wallet.ts.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const E2E_WALLET_PATH = "./e2e_wallet.json";
const VAULT_PDA = new PublicKey(process.env.VAULT_PDA || "3xkZeB3kbLboX4P3STucnRz3bPN7soQUWcueqmzEpLuQ");

function loadWallet(p: string) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const conn = new anchor.web3.Connection(RPC_URL, "confirmed");
  const e2e = loadWallet(E2E_WALLET_PATH);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(e2e), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;

  console.log("E2E wallet:", e2e.publicKey.toBase58());
  console.log("Vault:     ", VAULT_PDA.toBase58());

  console.log("\nAccepting authority...");
  const sig1 = await program.methods
    .acceptAuthority()
    .accountsStrict({ newAuthority: e2e.publicKey, vaultState: VAULT_PDA })
    .rpc();
  console.log("  sig:", sig1);

  console.log("\nAccepting admin...");
  const sig2 = await program.methods
    .acceptAdmin()
    .accountsStrict({ newAdmin: e2e.publicKey, vaultState: VAULT_PDA })
    .rpc();
  console.log("  sig:", sig2);

  const v = await program.account.vaultState.fetch(VAULT_PDA);
  console.log("\nDone:");
  console.log("  admin:    ", v.admin.toBase58());
  console.log("  authority:", v.authority.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

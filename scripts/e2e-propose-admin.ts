/**
 * Propose admin + authority transfer for the existing vault to the E2E wallet.
 * Run *after* setup-kamino-strategy.ts (which leaves admin as the script payer).
 * Then run e2e-accept-admin.ts as the E2E wallet to finalise.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import * as fs from "fs";

const RPC_URL = process.env.RPC_URL || "http://localhost:8899";
const VAULT_PDA = new PublicKey(process.env.VAULT_PDA!);
const NEW_OWNER = new PublicKey(process.env.NEW_OWNER!);
const PAYER_PATH = process.env.PAYER_PATH || "./id.json";

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_PATH, "utf-8"))));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;

  console.log("Proposing authority →", NEW_OWNER.toBase58());
  await program.methods
    .proposeAuthority(NEW_OWNER)
    .accountsStrict({ admin: provider.wallet.publicKey, vaultState: VAULT_PDA })
    .rpc();

  console.log("Proposing admin →", NEW_OWNER.toBase58());
  await program.methods
    .proposeAdmin(NEW_OWNER)
    .accountsStrict({ admin: provider.wallet.publicKey, vaultState: VAULT_PDA })
    .rpc();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });

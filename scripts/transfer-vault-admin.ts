/**
 * transfer-vault-admin.ts — propose admin and authority for one vault.
 *
 * Audit #21: admin / authority transfers are now two-step. This script runs
 * `propose_admin` and `propose_authority` from the *current* admin. The
 * recipient (TARGET_WALLET) must then call `accept_admin` and
 * `accept_authority` from their own keypair to finalise the transfer; until
 * they do, the live admin and authority remain unchanged.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import BN from "bn.js";

const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
const VAULT_ID = 4; // DeFi Alpha
const TARGET_WALLET = new PublicKey("DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike");
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8")))
  );
  const wallet = new anchor.Wallet(payer);
  anchor.setProvider(
    new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" })
  );
  const program = anchor.workspace.myProject as Program<MyProject>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      TOKEN_MINT.toBuffer(),
      new BN(VAULT_ID).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  const before = await program.account.vaultState.fetch(vaultPda);
  console.log(`Vault ${VAULT_ID}: ${vaultPda.toBase58()}`);
  console.log(`  before — admin=${before.admin.toBase58()} authority=${before.authority.toBase58()}`);

  if (!before.admin.equals(payer.publicKey)) {
    console.error(
      `\nPayer ${payer.publicKey.toBase58()} is not admin of vault ${VAULT_ID}. Aborting.`
    );
    process.exit(1);
  }

  const proposeAuthSig = await program.methods
    .proposeAuthority(TARGET_WALLET)
    .accountsStrict({ admin: payer.publicKey, vaultState: vaultPda })
    .rpc();
  console.log(`  propose_authority tx ${proposeAuthSig}`);

  const proposeAdminSig = await program.methods
    .proposeAdmin(TARGET_WALLET)
    .accountsStrict({ admin: payer.publicKey, vaultState: vaultPda })
    .rpc();
  console.log(`  propose_admin     tx ${proposeAdminSig}`);

  const after = await program.account.vaultState.fetch(vaultPda);
  console.log(
    `  after  — admin=${after.admin.toBase58()} (pending=${after.pendingAdmin.toBase58()}) authority=${after.authority.toBase58()} (pending=${after.pendingAuthority.toBase58()})`,
  );
  console.log(
    `\nTarget wallet ${TARGET_WALLET.toBase58()} must call accept_admin and accept_authority to finalise.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

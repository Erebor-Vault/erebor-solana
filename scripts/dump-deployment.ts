/**
 * dump-deployment.ts — print deterministic addresses for each vault in the
 * registry so docs/DEPLOYMENT.md can be regenerated. Read-only, no on-chain
 * mutation; just derives PDAs and reads VaultState + Strategy accounts.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

const RPC_URL = "https://api.devnet.solana.com";
const TOKEN_MINT = new PublicKey("5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N");
const NAMES = [
  "AT trader agent",
  "Conservative",
  "Aggressive Vault",
  "Stablecoin Yield",
  "DeFi Alpha",
];

async function main() {
  const conn = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(
    Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync("./id.json", "utf-8")))
    )
  );
  anchor.setProvider(new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" }));
  const program = anchor.workspace.myProject as Program<MyProject>;

  for (let id = 0; id < NAMES.length; id++) {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), vault.toBuffer()],
      program.programId
    );
    const [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vault.toBuffer()],
      program.programId
    );
    const reserveAta = anchor.utils.token.associatedAddress({ mint: TOKEN_MINT, owner: vaultAuthority });
    const v = await program.account.vaultState.fetch(vault);

    console.log(`\n## Vault ${id} — ${NAMES[id]}`);
    console.log(`Vault PDA:        ${vault.toBase58()}`);
    console.log(`Vault Authority:  ${vaultAuthority.toBase58()}`);
    console.log(`Share Mint:       ${shareMint.toBase58()}`);
    console.log(`Reserve ATA:      ${reserveAta.toBase58()}`);
    console.log(`Admin:            ${v.admin.toBase58()}`);
    console.log(`Authority:        ${v.authority.toBase58()}`);
    console.log(`Pending admin:    ${v.pendingAdmin.toBase58()}`);
    console.log(`Pending authority:${v.pendingAuthority.toBase58()}`);
    console.log(`Performance fee:  ${v.performanceFeeBps} bps`);
    console.log(`Active wt sum:    ${v.totalActiveWeightBps} bps`);
    console.log(`Total dep.:       ${v.totalDeposited.toNumber() / 1e6} USDC`);
    console.log(`Strategy cnt:     ${v.strategyCount.toNumber()}`);

    for (let s = 0; s < v.strategyCount.toNumber(); s++) {
      const [sPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy"), vault.toBuffer(), new BN(s).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [sAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_authority"), vault.toBuffer(), new BN(s).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [sToken] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_token"), vault.toBuffer(), new BN(s).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const sd = await program.account.strategyAllocation.fetch(sPda);
      console.log(
        `  S#${s}: pda=${sPda.toBase58()} auth=${sAuthority.toBase58()} token=${sToken.toBase58()} delegate=${sd.delegate.toBase58()} weight=${sd.targetWeightBps}bps allocated=${sd.allocatedAmount.toNumber() / 1e6}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

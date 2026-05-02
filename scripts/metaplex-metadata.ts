/**
 * Hand-built Metaplex Token Metadata helpers — no SDK, no extra deps.
 *
 * Builds the `CreateMetadataAccountV3` instruction (Borsh-serialized
 * args + the 7-account list) so devnet mock mints can carry on-chain
 * symbol/name/uri the frontend can read.
 *
 * Layout reference (Metaplex mpl-token-metadata v1.x):
 *   accounts:
 *     0  metadata          (writable)
 *     1  mint              (read)
 *     2  mint_authority    (signer)
 *     3  payer             (signer, writable)
 *     4  update_authority  (signer)
 *     5  system_program
 *     6  rent_sysvar       (optional in newer versions; we include it)
 *   data:
 *     u8  discriminator = 33  (CreateMetadataAccountV3)
 *     DataV2:
 *       string name   (u32 len + bytes)
 *       string symbol (u32 len + bytes)
 *       string uri    (u32 len + bytes)
 *       u16    seller_fee_basis_points
 *       Option<Vec<Creator>>      = None (1 byte: 0)
 *       Option<Collection>        = None (1 byte: 0)
 *       Option<Uses>              = None (1 byte: 0)
 *     bool   is_mutable = true
 *     Option<CollectionDetails> = None (1 byte: 0)
 */
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export function deriveMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

function encodeBorshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([lenBuf, bytes]);
}

function encodeBorshU16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n, 0);
  return buf;
}

export function createMetadataAccountV3Instruction(args: {
  metadata: PublicKey;
  mint: PublicKey;
  mintAuthority: PublicKey;
  payer: PublicKey;
  updateAuthority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  isMutable?: boolean;
}): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([33]), // discriminator: CreateMetadataAccountV3
    encodeBorshString(args.name),
    encodeBorshString(args.symbol),
    encodeBorshString(args.uri),
    encodeBorshU16(0), // seller_fee_basis_points
    Buffer.from([0]),  // creators = None
    Buffer.from([0]),  // collection = None
    Buffer.from([0]),  // uses = None
    Buffer.from([args.isMutable === false ? 0 : 1]), // is_mutable
    Buffer.from([0]),  // collection_details = None
  ]);

  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: args.metadata, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.mintAuthority, isSigner: true, isWritable: false },
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.updateAuthority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

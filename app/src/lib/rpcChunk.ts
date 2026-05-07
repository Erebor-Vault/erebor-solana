import type {
  AccountInfo,
  Commitment,
  Connection,
  PublicKey,
} from "@solana/web3.js";

// Solana RPC caps `getMultipleAccounts` at 100 keys per call; some providers
// (Helius) also bound the request body size, which can trip 413 below that
// limit on dense pages. 90 keeps headroom while still cutting round trips
// hard vs. one-key-at-a-time fetches.
const DEFAULT_CHUNK = 90;

export async function getMultipleAccountsInfoChunked(
  connection: Connection,
  keys: PublicKey[],
  commitment: Commitment = "confirmed",
  chunkSize: number = DEFAULT_CHUNK,
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (keys.length === 0) return [];
  if (keys.length <= chunkSize) {
    return connection.getMultipleAccountsInfo(keys, commitment);
  }
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < keys.length; i += chunkSize) {
    chunks.push(keys.slice(i, i + chunkSize));
  }
  const results = await Promise.all(
    chunks.map((c) => connection.getMultipleAccountsInfo(c, commitment)),
  );
  return results.flat();
}

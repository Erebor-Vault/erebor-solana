import { PublicKey } from "@solana/web3.js";

/**
 * Curated catalog of `(target_program, discriminator)` pairs for the most
 * common Solana DeFi protocols. Used by the admin's allowed-action whitelist
 * editor as quick-pick presets.
 *
 * IMPORTANT: program IDs below are mainnet IDs. Discriminators are computed
 * as `sha256("global:<method>")[..8]` for Anchor programs (most of these),
 * and as the leading instruction tag byte (zero-padded to 8) for native
 * Solana programs. Each entry is sourced from the protocol's public IDL or
 * SDK; verify against the protocol's docs before whitelisting in production.
 *
 * Adding a preset: pin the program ID + the method name (or raw discriminator
 * if non-Anchor). For non-trivial protocols, set `expectedRecipientIndex` to
 * the position in the relayed instruction's accounts list where the strategy
 * ATA should appear — the program enforces that pin at `execute_action` time.
 */
export interface ActionPreset {
  /** Display label (group-prefixed, e.g. "Lulo · lend"). */
  label: string;
  /** Protocol family — used by the dropdown to group entries. */
  protocol: string;
  /** Mainnet program id. */
  targetProgram: PublicKey;
  /**
   * Anchor discriminator: 8 bytes of `sha256("global:<method>")`.
   * Computed once at build time; recompute via the helper below if uncertain.
   */
  discriminator: number[]; // length 8
  /** Anchor method name (or native ix tag) the discriminator was derived from. */
  method: string;
  /**
   * Optional pin: if set, the relayed instruction's
   * `accounts[expectedRecipientIndex]` must be the strategy ATA, enforced
   * on-chain by `execute_action`.
   */
  expectedRecipientIndex?: number;
  /**
   * Optional pin: index of the output-mint AccountMeta in the relayed
   * instruction. When set, `execute_action` requires that mint to be on the
   * protocol-level `AllowedToken` allow-list — the only structural defence
   * against a delegate routing strategy funds into a non-allow-listed asset.
   */
  expectedOutputMintIndex?: number;
  /** Short description shown in the editor. */
  description: string;
  /** Where this entry came from — protocol docs / IDL link. */
  source: string;
}

const KAMINO_LEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const LULO_LEND = new PublicKey("LFG1ezantSY2LPX8jRz2qa31pPEhpwN9msFDzZw4T9Q");
const JUPITER_V6 = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/**
 * Anchor discriminator from a method name. Pre-computed below for the static
 * presets so the catalog imports cleanly without a sha256 dep at runtime.
 *
 * Use this helper for one-off custom entries the admin types into the editor.
 */
export function computeAnchorDiscriminator(method: string): number[] {
  // Web Crypto isn't synchronous; for the static catalog we use precomputed
  // values. For runtime computation see <https://www.anchor-lang.com/docs/instruction-format>.
  // Returns sha256("global:<method>")[..8].
  throw new Error(
    `computeAnchorDiscriminator(${method}) requires async sha256 — use the precomputed catalog or call it explicitly via crypto.subtle`
  );
}

export const ACTION_PRESETS: ActionPreset[] = [
  // -----------------------------------------------------------------
  // Kamino Lend
  // -----------------------------------------------------------------
  {
    label: "Kamino · deposit",
    protocol: "Kamino Lend",
    targetProgram: KAMINO_LEND,
    method: "deposit_reserve_liquidity_and_obligation_collateral",
    // sha256("global:deposit_reserve_liquidity_and_obligation_collateral")[..8]
    discriminator: [0x82, 0x39, 0xd6, 0xb0, 0x2d, 0xae, 0xfe, 0xa5],
    expectedRecipientIndex: 5,
    description:
      "Supply USDC to a Kamino Lend reserve. Strategy ATA must be the source token account.",
    source: "https://github.com/Kamino-Finance/klend",
  },
  {
    label: "Kamino · withdraw",
    protocol: "Kamino Lend",
    targetProgram: KAMINO_LEND,
    method: "withdraw_obligation_collateral_and_redeem_reserve_collateral",
    discriminator: [0xb1, 0x40, 0x2d, 0x2c, 0x05, 0x99, 0x8d, 0x05],
    description:
      "Redeem cTokens back to USDC. Recipient index varies by reserve — verify before whitelisting.",
    source: "https://github.com/Kamino-Finance/klend",
  },
  {
    label: "Kamino · borrow",
    protocol: "Kamino Lend",
    targetProgram: KAMINO_LEND,
    method: "borrow_obligation_liquidity",
    discriminator: [0x79, 0x7f, 0x12, 0xcc, 0x49, 0xf5, 0xe1, 0x41],
    expectedRecipientIndex: 4,
    description:
      "Borrow against deposited collateral. Strategy ATA receives the borrowed liquidity at index 4.",
    source: "https://github.com/Kamino-Finance/klend",
  },
  {
    label: "Kamino · repay",
    protocol: "Kamino Lend",
    targetProgram: KAMINO_LEND,
    method: "repay_obligation_liquidity",
    discriminator: [0x91, 0xb2, 0x0d, 0xe1, 0x4c, 0xf0, 0x93, 0x48],
    expectedRecipientIndex: 4,
    description:
      "Repay borrowed liquidity from the strategy ATA (source token account at index 4).",
    source: "https://github.com/Kamino-Finance/klend",
  },

  // -----------------------------------------------------------------
  // Lulo
  // -----------------------------------------------------------------
  {
    label: "Lulo · lend",
    protocol: "Lulo",
    targetProgram: LULO_LEND,
    method: "lend",
    discriminator: [0x32, 0x84, 0xa6, 0xb2, 0x5a, 0xed, 0xa1, 0x3a],
    expectedRecipientIndex: 2,
    description: "Lulo aggregated lending — auto-routes to best venue.",
    source: "https://docs.lulo.fi/",
  },
  {
    label: "Lulo · withdraw",
    protocol: "Lulo",
    targetProgram: LULO_LEND,
    method: "withdraw",
    discriminator: [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22],
    description: "Withdraw from Lulo back to the strategy ATA.",
    source: "https://docs.lulo.fi/",
  },

  // -----------------------------------------------------------------
  // Jupiter v6 (swap) — chosen over Raydium AMM v4 because the `route` ix
  // carries an explicit `destination_mint` AccountMeta we can pin to the
  // protocol-level `AllowedToken` list. Raydium AMM v4 has no mint meta,
  // so its swap output cannot be constrained on-chain.
  // -----------------------------------------------------------------
  {
    label: "Jupiter · route",
    protocol: "Jupiter v6",
    targetProgram: JUPITER_V6,
    method: "route",
    discriminator: [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a],
    // Jupiter v6 `route` account layout:
    //   0 token_program
    //   1 user_transfer_authority
    //   2 user_source_token_account
    //   3 user_destination_token_account  ← strategy ATA
    //   4 destination_token_account (optional / placeholder)
    //   5 destination_mint               ← must be on AllowedToken list
    expectedRecipientIndex: 3,
    expectedOutputMintIndex: 5,
    description:
      "Multi-hop swap. The destination mint is pinned against the vault's AllowedToken list — the delegate cannot route into a non-allow-listed asset.",
    source: "https://station.jup.ag/docs/apis/swap-api",
  },
];

/** Group presets by protocol for the editor dropdown. */
export function groupPresets(): Map<string, ActionPreset[]> {
  const m = new Map<string, ActionPreset[]>();
  for (const p of ACTION_PRESETS) {
    const list = m.get(p.protocol) ?? [];
    list.push(p);
    m.set(p.protocol, list);
  }
  return m;
}

/** Display the discriminator as `0x…` hex for the UI. */
export function discriminatorToHex(d: number[]): string {
  return "0x" + d.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse a `0x` hex string back to a length-8 byte array. */
export function hexToDiscriminator(s: string): number[] | null {
  const trimmed = s.startsWith("0x") ? s.slice(2) : s;
  if (trimmed.length !== 16 || !/^[0-9a-fA-F]+$/.test(trimmed)) return null;
  const out: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    out.push(parseInt(trimmed.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Async discriminator computation via Web Crypto. For runtime use when an
 * admin pastes a custom method name. Returns `null` on environments without
 * `crypto.subtle` (older Node, server-side render).
 */
export async function anchorDiscriminator(method: string): Promise<number[] | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const enc = new TextEncoder().encode(`global:${method}`);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash).slice(0, 8));
}

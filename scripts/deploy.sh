#!/usr/bin/env bash
#
# deploy.sh — Deploy the sol-vault program to devnet or mainnet-beta.
#
# Usage:
#   ./scripts/deploy.sh devnet              # deploy to devnet (default wallet: ./id.json)
#   ./scripts/deploy.sh mainnet             # deploy to mainnet-beta
#   ./scripts/deploy.sh devnet ~/my-key.json  # deploy with a custom wallet
#
# Prerequisites:
#   - anchor CLI installed (0.32.1)
#   - solana CLI in PATH
#   - Program keypair at target/deploy/my_project-keypair.json
#   - Wallet with enough SOL for deployment (~3-5 SOL)
#
# What this script does:
#   1. Validates inputs and prerequisites
#   2. Checks wallet SOL balance
#   3. Builds the program (anchor build)
#   4. Verifies the program ID matches declare_id! in lib.rs
#   5. Deploys with anchor deploy
#   6. Optionally initializes the vault for a given token mint

set -euo pipefail

# -------------------------------------------------------------------
# Config
# -------------------------------------------------------------------
PROGRAM_NAME="my_project"
PROGRAM_KEYPAIR="target/deploy/${PROGRAM_NAME}-keypair.json"
PROGRAM_SO="target/deploy/${PROGRAM_NAME}.so"
MIN_SOL_DEVNET=3
MIN_SOL_MAINNET=5

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -------------------------------------------------------------------
# Functions
# -------------------------------------------------------------------
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
  echo "Usage: $0 <devnet|mainnet> [wallet-path]"
  echo ""
  echo "Arguments:"
  echo "  devnet|mainnet    Target cluster"
  echo "  wallet-path       Path to wallet keypair (default: ./id.json)"
  echo ""
  echo "Examples:"
  echo "  $0 devnet"
  echo "  $0 mainnet ~/.config/solana/id.json"
  exit 1
}

check_command() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is not installed or not in PATH"
  fi
}

# -------------------------------------------------------------------
# Parse arguments
# -------------------------------------------------------------------
if [ $# -lt 1 ]; then
  usage
fi

CLUSTER="$1"
WALLET="${2:-./id.json}"

case "$CLUSTER" in
  devnet)
    RPC_URL="https://api.devnet.solana.com"
    MIN_SOL=$MIN_SOL_DEVNET
    ANCHOR_CLUSTER="devnet"
    ;;
  mainnet)
    RPC_URL="https://api.mainnet-beta.solana.com"
    MIN_SOL=$MIN_SOL_MAINNET
    ANCHOR_CLUSTER="mainnet"
    ;;
  *)
    error "Unknown cluster: $CLUSTER. Use 'devnet' or 'mainnet'."
    ;;
esac

# -------------------------------------------------------------------
# Pre-flight checks
# -------------------------------------------------------------------
info "Pre-flight checks..."

check_command anchor
check_command solana

if [ ! -f "$WALLET" ]; then
  error "Wallet keypair not found at: $WALLET"
fi

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  error "Program keypair not found at: $PROGRAM_KEYPAIR. Run 'anchor build' first."
fi

# Get wallet address
WALLET_ADDR=$(solana address -k "$WALLET")
info "Wallet: $WALLET_ADDR"

# Get program ID from keypair
PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR")
info "Program ID: $PROGRAM_ID"

# Verify program ID matches lib.rs declare_id!
DECLARED_ID=$(grep 'declare_id!' programs/${PROGRAM_NAME}/src/lib.rs | sed 's/.*"\(.*\)".*/\1/')
if [ "$PROGRAM_ID" != "$DECLARED_ID" ]; then
  error "Program ID mismatch!\n  Keypair:     $PROGRAM_ID\n  declare_id!: $DECLARED_ID\n\nRun: anchor keys sync"
fi
info "Program ID matches declare_id! in lib.rs"

# Check SOL balance
info "Checking balance on $CLUSTER..."
BALANCE=$(solana balance "$WALLET_ADDR" --url "$RPC_URL" 2>/dev/null | awk '{print $1}')

if [ -z "$BALANCE" ]; then
  error "Could not fetch balance. Check your network connection and RPC URL."
fi

# Compare balance (integer comparison, floor the balance)
BALANCE_INT=${BALANCE%.*}
if [ "$BALANCE_INT" -lt "$MIN_SOL" ]; then
  error "Insufficient SOL balance: ${BALANCE} SOL (need at least ${MIN_SOL} SOL)\n\nFor devnet, get SOL from: solana airdrop 5 $WALLET_ADDR --url $RPC_URL"
fi
info "Balance: ${BALANCE} SOL"

# -------------------------------------------------------------------
# Mainnet safety gate
# -------------------------------------------------------------------
if [ "$CLUSTER" = "mainnet" ]; then
  echo ""
  warn "You are about to deploy to MAINNET-BETA."
  warn "Program ID: $PROGRAM_ID"
  warn "Wallet:     $WALLET_ADDR"
  warn "Balance:    ${BALANCE} SOL"
  echo ""
  read -rp "Type 'yes' to confirm mainnet deployment: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    info "Deployment cancelled."
    exit 0
  fi
  echo ""
fi

# -------------------------------------------------------------------
# Build
# -------------------------------------------------------------------
info "Building program..."
anchor build 2>&1

if [ ! -f "$PROGRAM_SO" ]; then
  error "Build failed — $PROGRAM_SO not found."
fi

PROGRAM_SIZE=$(du -h "$PROGRAM_SO" | awk '{print $1}')
info "Program size: $PROGRAM_SIZE"

# -------------------------------------------------------------------
# Deploy
# -------------------------------------------------------------------
info "Deploying to $CLUSTER ($RPC_URL)..."

if [ "$CLUSTER" = "mainnet" ]; then
  info "Mainnet deploy: restricting to my_project only (mock_* programs are devnet-only)."
  anchor deploy \
    --program-name my_project \
    --provider.cluster "$ANCHOR_CLUSTER" \
    --provider.wallet "$WALLET" \
    2>&1
else
  anchor deploy \
    --provider.cluster "$ANCHOR_CLUSTER" \
    --provider.wallet "$WALLET" \
    2>&1
fi

# -------------------------------------------------------------------
# Verify deployment
# -------------------------------------------------------------------
info "Verifying deployment..."
PROGRAM_INFO=$(solana account "$PROGRAM_ID" --url "$RPC_URL" --output json 2>/dev/null || true)
if echo "$PROGRAM_INFO" | grep -q "$PROGRAM_ID"; then
  info "Program deployed successfully!"
else
  # Fallback: if the deploy command itself succeeded, trust it
  info "Program deployed (on-chain query inconclusive — check explorer)."
fi

echo ""
echo "  Cluster:    $CLUSTER"
echo "  Program ID: $PROGRAM_ID"
echo "  Authority:  $WALLET_ADDR"
echo ""
echo "  Explorer:   https://explorer.solana.com/address/${PROGRAM_ID}?cluster=${CLUSTER}"
echo ""

# -------------------------------------------------------------------
# Post-deploy instructions
# -------------------------------------------------------------------
info "Next steps:"
echo ""
echo "  1. Initialize the vault for your token mint:"
echo "     bunx ts-node scripts/init-vault.ts --cluster $CLUSTER --mint <TOKEN_MINT_ADDRESS>"
echo ""
echo "  2. Verify the program on-chain:"
echo "     solana program show $PROGRAM_ID --url $RPC_URL"
echo ""
if [ "$CLUSTER" = "devnet" ]; then
  echo "  3. Run integration tests against devnet:"
  echo "     ANCHOR_PROVIDER_URL=$RPC_URL anchor test --skip-local-validator"
  echo ""
fi

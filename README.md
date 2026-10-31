# Safe Wallet — Relayer Backend

Node.js / TypeScript backend that acts as a gas relayer for a passkey-secured [Safe](https://safe.global) smart account wallet on **Arbitrum Sepolia** testnet.

**Live API:** `https://backend-whitzy.vercel.app`

## What it does

The backend sits between the mobile app and the blockchain. It holds a funded **relayer EOA** that pays gas on behalf of users, so users never need ETH in their own wallet to get started.

```
iPhone (passkey sign) → backend → Arbitrum Sepolia
                                    ├─ SafeWebAuthnSignerFactory (deploy signer contract)
                                    ├─ SafeProxyFactory (deploy Safe)
                                    └─ Safe.execTransaction (relay signed tx)
```

## Architecture

### Why Safe smart accounts?

A standard EOA wallet is secured by a single private key — lose the key, lose everything. Safe smart accounts are contracts with configurable owners and thresholds. Here, the single owner is a **WebAuthn signer contract** whose public key lives in the iPhone's Secure Enclave. There is no seed phrase, no private key the user ever sees.

### Why passkeys (WebAuthn)?

Passkeys use the device's Secure Enclave (iOS) or TPM (Android/Windows). The private key never leaves the chip. Authentication is P-256 (secp256r1) signatures under the hood — the same curve Ethereum's precompile `0x0100` verifies natively on Arbitrum.

### Signature flow

```
1. Mobile builds a Safe transaction hash
2. Mobile calls WebAuthn `navigator.credentials.get()` → iPhone prompts Face ID
3. Secure Enclave signs the hash with the passkey private key (P-256)
4. Mobile sends: authenticatorData, clientDataFields, r, s to /api/wallet/send/execute
5. Backend packs these into the Safe contract-signature format:
      [signerAddress (32 bytes)] [offset (32 bytes)] [sigType=0 (1 byte)]
      [webAuthnSig length] [webAuthnSig bytes]
6. Backend calls safe.executeTransaction() — relayer pays gas
7. Returns txHash + Arbiscan link
```

### Contract addresses (Arbitrum Sepolia)

| Contract | Address |
|---|---|
| Safe 1.4.1 Singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| SafeProxyFactory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| SafeWebAuthnSignerFactory | `0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf` |
| SafeWebAuthnSharedSigner | `0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9` |
| P-256 Verifier (precompile) | `0x0000000000000000000000000000000000000100` |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/api/wallet/create` | Deploy passkey signer + Safe, returns `safeAddress` |
| `GET` | `/api/wallet/:address/balance` | ETH / USDC / ARB balances |
| `GET` | `/api/wallet/:address/transactions` | Transaction history (stub — needs indexer) |
| `POST` | `/api/wallet/send/prepare` | Build Safe tx, returns `safeTxHash` to sign |
| `POST` | `/api/wallet/send/execute` | Execute signed Safe tx, returns `txHash` |

### POST /api/wallet/create

```json
// Request
{ "x": "0x<pubkeyX as 256-bit hex>", "y": "0x<pubkeyY as 256-bit hex>" }

// Response
{
  "safeAddress": "0x...",
  "signerAddress": "0x...",
  "network": "arbitrum-sepolia",
  "explorerUrl": "https://sepolia.arbiscan.io/address/0x..."
}
```

### POST /api/wallet/send/execute

```json
// Request
{
  "safeTxHash": "0x...",
  "signerAddress": "0x...",
  "authenticatorData": "0x...",
  "clientDataFields": "\"origin\":\"https://...\",\"crossOrigin\":false",
  "r": "12345...",
  "s": "67890..."
}

// Response
{ "txHash": "0x...", "explorerUrl": "https://sepolia.arbiscan.io/tx/0x..." }
```

## Stack

- **Runtime**: Node.js 20, TypeScript (ESM)
- **Framework**: Express
- **Chain interaction**: [viem](https://viem.sh) v2
- **Safe SDK**: `@safe-global/protocol-kit` v4 + `@safe-global/api-kit` v2
- **Deploy**: Vercel serverless (single function)

## Running locally

```bash
cp .env.example .env
# Fill in RELAYER_PRIVATE_KEY and optionally ALCHEMY_RPC_URL
npm install
npm run dev      # tsx watch on :3001
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | Yes | EOA that pays gas for all deployments + transactions |
| `ALCHEMY_RPC_URL` | No | Falls back to public Arbitrum Sepolia RPC |

## What's production-missing

- **Persistent pending tx store** — currently in-memory `Map`; needs Redis or a DB
- **Real tx history** — needs a blockchain indexer (The Graph / Alchemy Transfers API)
- **Rate limiting** — relayer is open; a funded attacker could drain it
- **Mainnet contract addresses** — config swap only; all logic is chain-agnostic
- **Token price feeds** — USD values are hardcoded; needs Chainlink or CoinGecko

## Repo companion

Mobile app: [safe-wallet-expo](https://github.com/whitzytraiding-max/safe-wallet-expo)

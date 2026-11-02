# Safe Wallet — Relayer Backend

Node.js / TypeScript relayer backend for a passkey-secured [Safe](https://safe.global) smart account wallet on **Arbitrum Sepolia** testnet.

**Live API:** `https://backend-whitzy.vercel.app`

## How it works

The backend is a stateless gas relayer. It holds a funded relayer EOA that pays gas on behalf of users, so users never need ETH in their wallet before their first send.

```
iPhone (Face ID) → backend → Arbitrum Sepolia
                               ├─ SafeWebAuthnSignerFactory.createSigner(x, y, verifier)
                               ├─ SafeProxyFactory.createProxyWithNonce(...)
                               └─ Safe.execTransaction(webauthnSig)
```

### Why Safe smart accounts?

Safe smart accounts are ownerless contracts with configurable signers and thresholds. The single owner here is a **SafeWebAuthnSigner** contract whose P-256 public key comes from the device's Secure Enclave. No seed phrase, no exported private key.

### WebAuthn → Safe signature flow

```
1. /send/prepare  — builds the Safe tx, returns safeTxHash + txParams
2. Mobile          — uses base64url(safeTxHash) as the WebAuthn challenge for Face ID
3. Secure Enclave — signs: sha256(authenticatorData ‖ sha256(clientDataJSON))
4. /send/execute  — packs (authenticatorData, clientDataFields, r, s) into the Safe
                     contract-signature format and relays the transaction
```

The stateless design avoids any server-side tx store: `prepare` returns the raw tx params back to the client, and `execute` reconstructs the Safe transaction from them.

### Contract addresses (Arbitrum Sepolia)

| Contract | Address |
|---|---|
| Safe 1.4.1 Singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| SafeProxyFactory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| SafeWebAuthnSignerFactory | `0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf` |
| SafeWebAuthnSharedSigner | `0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9` |
| P-256 Verifier (Daimo) | `0xc2b78104907F722DABAc4C69f826a522B2754De4` |

> The EIP-7212 precompile (`0x100`) is not active on Arbitrum Sepolia. The Daimo pure-Solidity verifier is used instead and is deployed at the same deterministic address across chains.

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/api/wallet/create` | Deploy signer + Safe, returns addresses |
| `GET` | `/api/wallet/:address/balance` | ETH / USDC / ARB balances |
| `GET` | `/api/wallet/:address/transactions` | Transaction history (stub) |
| `POST` | `/api/wallet/send/prepare` | Build Safe tx, return `safeTxHash` + `txParams` |
| `POST` | `/api/wallet/send/execute` | Submit signed tx, return `txHash` |

### POST /api/wallet/create

```json
// Request
{ "x": "0x<pubkeyX 256-bit hex>", "y": "0x<pubkeyY 256-bit hex>" }

// Response
{
  "safeAddress": "0x...",
  "signerAddress": "0x...",
  "network": "arbitrum-sepolia",
  "explorerUrl": "https://sepolia.arbiscan.io/address/0x..."
}
```

### POST /api/wallet/send/prepare

```json
// Request
{ "safeAddress": "0x...", "to": "0x...", "amount": "0.001", "token": "ETH" }

// Response
{
  "safeTxHash": "0x...",
  "txParams": { "safeAddress": "0x...", "txTo": "0x...", "txValue": "1000000000000000", "txData": "0x" }
}
```

### POST /api/wallet/send/execute

```json
// Request
{
  "signerAddress": "0x...",
  "authenticatorData": "0x...",
  "clientDataFields": ",\"origin\":\"https://...\",\"crossOrigin\":false}",
  "r": "12345...",
  "s": "67890...",
  "txParams": { "safeAddress": "0x...", "txTo": "0x...", "txValue": "...", "txData": "0x" }
}

// Response
{ "txHash": "0x...", "explorerUrl": "https://sepolia.arbiscan.io/tx/0x..." }
```

## Stack

- **Runtime**: Node.js 20, TypeScript (ESM)
- **Framework**: Express
- **Chain interaction**: [viem](https://viem.sh) v2
- **Safe SDK**: `@safe-global/protocol-kit` v4
- **Deploy**: Vercel serverless

## Local development

```bash
cp .env.example .env
# Set RELAYER_PRIVATE_KEY to a testnet EOA funded with Arbitrum Sepolia ETH
npm install
npm run dev      # tsx watch on :3001
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | Yes | EOA private key — pays gas for all deployments and relayed txs |
| `ALCHEMY_RPC_URL` | No | Falls back to the public Arbitrum Sepolia RPC |

## Production gaps

- **Mainnet contract addresses** — config swap only; all logic is chain-agnostic
- **Token price feeds** — ETH/ARB prices are hardcoded; replace with Chainlink
- **Rate limiting** — relayer is open; add per-user limits to protect the relayer balance
- **Transaction history** — stub endpoint; needs a blockchain indexer (The Graph or Alchemy)
- **Account recovery** — no guardian/secondary owner; add as a second Safe owner

## Companion app

Mobile frontend: [safe-wallet-expo](https://github.com/whitzytraiding-max/safe-wallet-expo)

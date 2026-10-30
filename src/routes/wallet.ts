import { Router } from 'express'
import type { Request, Response } from 'express'
import { type Address, type Hex, isAddress } from 'viem'
import { deploySafe, buildTransaction, executeTransaction, getPasskeySignerAddress } from '../services/passkeyWallet.js'
import { getWalletBalances } from '../services/balance.js'

export const walletRouter = Router()

// POST /api/wallet/create
// Body: { x: "0x...", y: "0x..." }  (passkey public key coordinates as 0x-prefixed hex)
walletRouter.post('/create', async (req: Request, res: Response) => {
  try {
    const { x, y } = req.body as { x: string; y: string }
    if (!x || !y) return res.status(400).json({ error: 'x and y required' })

    const passkeyX = BigInt(x)
    const passkeyY = BigInt(y)

    const safeAddress = await deploySafe(passkeyX, passkeyY)
    const signerAddress = await getPasskeySignerAddress(passkeyX, passkeyY)

    res.json({
      safeAddress,
      signerAddress,
      network: 'arbitrum-sepolia',
      explorerUrl: `https://sepolia.arbiscan.io/address/${safeAddress}`,
    })
  } catch (err: unknown) {
    console.error('/create error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/wallet/:address/balance
walletRouter.get('/:address/balance', async (req: Request, res: Response) => {
  try {
    const { address } = req.params
    if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' })

    const result = await getWalletBalances(address as Address)
    res.json(result)
  } catch (err: unknown) {
    console.error('/balance error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/wallet/send/prepare
// Body: { safeAddress, to, valueWei, data? }
// Returns the safeTxHash the iOS app needs to sign with the passkey
walletRouter.post('/send/prepare', async (req: Request, res: Response) => {
  try {
    const { safeAddress, to, valueWei, data } = req.body as {
      safeAddress: string; to: string; valueWei: string; data?: string
    }
    if (!isAddress(safeAddress) || !isAddress(to)) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    const { safeTxHash, safeTransaction } = await buildTransaction(
      safeAddress as Address,
      to as Address,
      BigInt(valueWei || '0'),
      (data || '0x') as Hex,
    )

    // Store transaction in memory keyed by hash (production: use a DB)
    pendingTxs.set(safeTxHash, { safeAddress, safeTransaction })

    res.json({ safeTxHash })
  } catch (err: unknown) {
    console.error('/send/prepare error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/wallet/send/execute
// Body: { safeTxHash, signerAddress, authenticatorData, clientDataFields, r, s }
walletRouter.post('/send/execute', async (req: Request, res: Response) => {
  try {
    const { safeTxHash, signerAddress, authenticatorData, clientDataFields, r, s } = req.body as {
      safeTxHash: Hex
      signerAddress: Address
      authenticatorData: Hex
      clientDataFields: string
      r: string
      s: string
    }

    const pending = pendingTxs.get(safeTxHash)
    if (!pending) return res.status(404).json({ error: 'Transaction not found or expired' })

    const txHash = await executeTransaction(
      pending.safeAddress as Address,
      pending.safeTransaction,
      signerAddress,
      authenticatorData,
      clientDataFields,
      BigInt(r),
      BigInt(s),
    )

    pendingTxs.delete(safeTxHash)
    res.json({
      txHash,
      explorerUrl: `https://sepolia.arbiscan.io/tx/${txHash}`,
    })
  } catch (err: unknown) {
    console.error('/send/execute error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// In-memory pending tx store (replace with Redis/DB in production)
const pendingTxs = new Map<string, { safeAddress: string; safeTransaction: unknown }>()

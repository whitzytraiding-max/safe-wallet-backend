import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  type Address,
  type Hex,
  isAddress,
  parseEther,
  parseUnits,
  encodeFunctionData,
} from 'viem'
import {
  deploySafe,
  buildTransaction,
  executeTransaction,
  getPasskeySignerAddress,
} from '../services/passkeyWallet.js'
import { getWalletBalances } from '../services/balance.js'
import { TOKENS } from '../config.js'

export const walletRouter = Router()

const erc20TransferAbi = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const


// POST /api/wallet/create
// Body: { x: "0x...", y: "0x..." }
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
// Returns flat { eth, usdc, arb, totalUSD } the frontend expects
walletRouter.get('/:address/balance', async (req: Request, res: Response) => {
  try {
    const { address } = req.params
    if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' })

    const result = await getWalletBalances(address as Address)

    const eth = parseFloat(result.balances.find(b => b.symbol === 'ETH')?.balance ?? '0')
    const usdc = parseFloat(result.balances.find(b => b.symbol === 'USDC')?.balance ?? '0')
    const arb = parseFloat(result.balances.find(b => b.symbol === 'ARB')?.balance ?? '0')

    const ETH_PRICE = 2450
    const ARB_PRICE = 0.72
    const totalUSD = eth * ETH_PRICE + usdc * 1 + arb * ARB_PRICE

    res.json({ eth, usdc, arb, totalUSD })
  } catch (err: unknown) {
    console.error('/balance error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/wallet/:address/transactions
// Returns empty array for now — transactions require an indexer
walletRouter.get('/:address/transactions', async (req: Request, res: Response) => {
  try {
    const { address } = req.params
    if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' })
    // Future: query Safe Transaction Service or an indexer
    res.json([])
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/wallet/send/prepare
// Body: { safeAddress, to, amount, token }
walletRouter.post('/send/prepare', async (req: Request, res: Response) => {
  try {
    const { safeAddress, to, amount, token } = req.body as {
      safeAddress: string
      to: string
      amount: string
      token: string
    }

    if (!isAddress(safeAddress) || !isAddress(to)) {
      return res.status(400).json({ error: 'Invalid address' })
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    let txTo: Address
    let txValue: bigint
    let txData: Hex

    if (token === 'ETH') {
      txTo = to as Address
      txValue = parseEther(amount)
      txData = '0x'
    } else if (token === 'USDC') {
      txTo = TOKENS.USDC
      txValue = 0n
      txData = encodeFunctionData({
        abi: erc20TransferAbi,
        functionName: 'transfer',
        args: [to as Address, parseUnits(amount, 6)],
      })
    } else if (token === 'ARB') {
      txTo = TOKENS.ARB as Address
      txValue = 0n
      txData = encodeFunctionData({
        abi: erc20TransferAbi,
        functionName: 'transfer',
        args: [to as Address, parseUnits(amount, 18)],
      })
    } else {
      return res.status(400).json({ error: `Unsupported token: ${token}` })
    }

    const { safeTxHash } = await buildTransaction(
      safeAddress as Address,
      txTo,
      txValue,
      txData,
    )

    // Return tx params to client so execute can reconstruct without server-side state
    res.json({
      safeTxHash,
      txParams: { safeAddress, txTo, txValue: txValue.toString(), txData },
    })
  } catch (err: unknown) {
    console.error('/send/prepare error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/wallet/send/execute
// Body: { signerAddress, authenticatorData, clientDataFields, r, s, txParams: { safeAddress, txTo, txValue, txData } }
walletRouter.post('/send/execute', async (req: Request, res: Response) => {
  try {
    const { signerAddress, authenticatorData, clientDataFields, r, s, txParams } = req.body as {
      signerAddress: Address
      authenticatorData: Hex
      clientDataFields: string
      r: string
      s: string
      txParams: { safeAddress: string; txTo: string; txValue: string; txData: string }
    }

    if (!signerAddress || !authenticatorData || !clientDataFields || !r || !s || !txParams) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Reconstruct the safeTransaction from the original params (stateless — no server-side map)
    const { safeTransaction } = await buildTransaction(
      txParams.safeAddress as Address,
      txParams.txTo as Address,
      BigInt(txParams.txValue),
      txParams.txData as Hex,
    )

    const txHash = await executeTransaction(
      txParams.safeAddress as Address,
      safeTransaction,
      signerAddress,
      authenticatorData,
      clientDataFields,
      BigInt(r),
      BigInt(s),
    )

    res.json({
      txHash,
      explorerUrl: `https://sepolia.arbiscan.io/tx/${txHash}`,
    })
  } catch (err: unknown) {
    console.error('/send/execute error:', err)
    res.status(500).json({ error: String(err) })
  }
})

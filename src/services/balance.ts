import { createPublicClient, http, formatEther, formatUnits, type Address } from 'viem'
import { CHAIN, RPC_URL, TOKENS } from '../config.js'

const erc20Abi = [
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { name: 'decimals',  type: 'function', inputs: [], outputs: [{ name: '', type: 'uint8' }],  stateMutability: 'view' },
  { name: 'symbol',   type: 'function', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
] as const

const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })

export interface TokenBalance {
  symbol: string
  balance: string       // human-readable
  balanceRaw: string    // wei/smallest unit
  decimals: number
  usdPrice: number | null
}

async function getErc20Balance(
  walletAddress: Address,
  tokenAddress: Address,
): Promise<TokenBalance> {
  const [balanceRaw, decimals, symbol] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [walletAddress] }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'symbol' }),
  ])
  return {
    symbol,
    balance: formatUnits(balanceRaw, decimals),
    balanceRaw: balanceRaw.toString(),
    decimals,
    usdPrice: null, // populated by caller if needed
  }
}

export async function getWalletBalances(safeAddress: Address) {
  const [ethWei, usdc, arb] = await Promise.all([
    client.getBalance({ address: safeAddress }),
    getErc20Balance(safeAddress, TOKENS.USDC).catch(() => null),
    getErc20Balance(safeAddress, TOKENS.ARB).catch(() => null),
  ])

  const eth: TokenBalance = {
    symbol: 'ETH',
    balance: formatEther(ethWei),
    balanceRaw: ethWei.toString(),
    decimals: 18,
    usdPrice: null,
  }

  return {
    address: safeAddress,
    network: { name: CHAIN.name, chainId: CHAIN.id },
    balances: [eth, usdc, arb].filter(Boolean) as TokenBalance[],
  }
}

export async function estimateGas(
  from: Address,
  to: Address,
  value: bigint,
): Promise<{ estimatedGasWei: string; estimatedFeesWei: string }> {
  const [gas, feeData] = await Promise.all([
    client.estimateGas({ account: from, to, value }).catch(() => 150000n),
    client.estimateFeesPerGas(),
  ])
  const maxFeePerGas = feeData.maxFeePerGas ?? 100000000n
  return {
    estimatedGasWei: gas.toString(),
    estimatedFeesWei: (gas * maxFeePerGas).toString(),
  }
}

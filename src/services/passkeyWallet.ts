import SafeModule, { SafeFactory, EthSafeSignature } from '@safe-global/protocol-kit'
// protocol-kit is CJS; in Node.js ESM the default import is the exports object, not the class
const Safe = ((SafeModule as any).default ?? SafeModule) as typeof SafeModule
import { ethers } from 'ethers'
import {
  createPublicClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toBytes,
  toHex,
  type Hex,
  type Address,
} from 'viem'
import {
  CHAIN,
  RPC_URL,
  RELAYER_PRIVATE_KEY,
  SAFE_ADDRESSES,
  WEBAUTHN_SIGNER_FACTORY,
  WEBAUTHN_SHARED_SIGNER,
  P256_VERIFIER,
} from '../config.js'

const signerFactoryAbi = [
  'function createSigner(uint256 x, uint256 y, uint176 verifiers) returns (address signer)',
  'function getSigner(uint256 x, uint256 y, uint176 verifiers) view returns (address signer)',
]

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })

function getRelayerWallet() {
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  return new ethers.Wallet(RELAYER_PRIVATE_KEY, provider)
}

function buildVerifiers(): bigint {
  return BigInt(P256_VERIFIER)
}

export async function getPasskeySignerAddress(x: bigint, y: bigint): Promise<Address> {
  const wallet = getRelayerWallet()
  const factory = new ethers.Contract(WEBAUTHN_SIGNER_FACTORY, signerFactoryAbi, wallet)
  const address = await factory.getSigner(x, y, buildVerifiers())
  return address as Address
}

export async function deployPasskeySignerIfNeeded(x: bigint, y: bigint): Promise<Address> {
  const wallet = getRelayerWallet()
  const factory = new ethers.Contract(WEBAUTHN_SIGNER_FACTORY, signerFactoryAbi, wallet)
  const signerAddress: Address = await factory.getSigner(x, y, buildVerifiers())

  // Check if already deployed
  const code = await publicClient.getCode({ address: signerAddress })
  if (code && code !== '0x') return signerAddress

  // Deploy signer via ethers.js — tx.wait() blocks until the tx is mined and the wallet's
  // internal nonce counter advances, so the next tx from this wallet uses the correct nonce.
  const tx = await factory.createSigner(x, y, buildVerifiers())
  await tx.wait()

  // Brief pause to let the RPC propagate the confirmed state before SafeFactory reads it
  await new Promise(r => setTimeout(r, 2000))

  return signerAddress
}

export async function deploySafe(passkeyX: bigint, passkeyY: bigint): Promise<Address> {
  const signerAddress = await deployPasskeySignerIfNeeded(passkeyX, passkeyY)

  const safeFactory = await SafeFactory.init({
    provider: RPC_URL,
    signer: RELAYER_PRIVATE_KEY,
    safeVersion: '1.4.1',
    contractNetworks: {
      [String(CHAIN.id)]: SAFE_ADDRESSES as any,
    },
  })

  const safeConfig = { owners: [signerAddress], threshold: 1 }
  const safe = await safeFactory.deploySafe({ safeAccountConfig: safeConfig })
  return await safe.getAddress() as Address
}

export async function buildTransaction(
  safeAddress: Address,
  to: Address,
  value: bigint,
  data: Hex = '0x',
): Promise<{ safeTxHash: Hex; safeTransaction: unknown }> {
  const safe = await Safe.init({
    provider: RPC_URL,
    signer: RELAYER_PRIVATE_KEY,
    safeAddress,
    contractNetworks: { [String(CHAIN.id)]: { ...SAFE_ADDRESSES, safeWebAuthnSignerFactoryAddress: WEBAUTHN_SIGNER_FACTORY, safeWebAuthnSharedSignerAddress: WEBAUTHN_SHARED_SIGNER } },
  })

  const safeTransaction = await safe.createTransaction({
    transactions: [{ to, value: value.toString(), data }],
  })

  const safeTxHash = await safe.getTransactionHash(safeTransaction) as Hex
  return { safeTxHash, safeTransaction }
}

// Pack a WebAuthn assertion into the Safe signature format expected by SafeWebAuthnSigner
function packWebAuthnSignature(
  authenticatorData: Hex,
  clientDataFields: string,  // the JSON fields between "challenge":"..." and the closing }
  r: bigint,
  s: bigint,
): Hex {
  const clientDataBytes = toBytes(clientDataFields)
  return encodeAbiParameters(
    parseAbiParameters('bytes,bytes,uint256,uint256'),
    [authenticatorData, toHex(clientDataBytes), r, s],
  )
}

// Build the full Safe signature for a contract signer (ERC-1271 style)
function buildContractSignature(signerAddress: Address, webauthnSig: Hex): Hex {
  // Safe contract signature format:
  // [0:32]  - signer address padded to 32 bytes
  // [32:64] - offset to signature data (= 65, pointing past the static part)
  // [64]    - signature type = 0
  // [65:97] - signature data length
  // [97+]   - signature data
  const STATIC_PART_LEN = 65n
  const sigBytes = toBytes(webauthnSig)
  const sigLen = BigInt(sigBytes.length)

  const staticPart = encodeAbiParameters(
    parseAbiParameters('address,uint256,uint8'),
    [signerAddress, STATIC_PART_LEN, 0],
  )

  const dynamicPart = encodeAbiParameters(
    parseAbiParameters('bytes'),
    [webauthnSig],
  )

  return (staticPart + dynamicPart.slice(2)) as Hex
}

export async function executeTransaction(
  safeAddress: Address,
  safeTransaction: unknown,
  signerAddress: Address,
  authenticatorData: Hex,
  clientDataFields: string,
  r: bigint,
  s: bigint,
): Promise<Hex> {
  const webauthnSig = packWebAuthnSignature(authenticatorData, clientDataFields, r, s)

  // -- DEBUG --
  const safe0 = await Safe.init({
    provider: RPC_URL, signer: RELAYER_PRIVATE_KEY, safeAddress,
    contractNetworks: { [String(CHAIN.id)]: { ...SAFE_ADDRESSES, safeWebAuthnSignerFactoryAddress: WEBAUTHN_SIGNER_FACTORY, safeWebAuthnSharedSignerAddress: WEBAUTHN_SHARED_SIGNER } },
  })
  const debugTxHash = await safe0.getTransactionHash(safeTransaction as any) as Hex
  console.log('[execute] safeTxHash:', debugTxHash)
  console.log('[execute] clientDataFields:', JSON.stringify(clientDataFields))
  console.log('[execute] clientDataFields ends with }:', clientDataFields.endsWith('}'))
  // Call isValidSignature(bytes32,bytes) directly — bypasses Safe, tests WebAuthn sig only
  try {
    const sigResult = await publicClient.readContract({
      address: signerAddress,
      abi: [{
        name: 'isValidSignature',
        type: 'function',
        inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }],
        outputs: [{ name: '', type: 'bytes4' }],
        stateMutability: 'view',
      }] as const,
      functionName: 'isValidSignature',
      args: [debugTxHash, webauthnSig],
    })
    console.log('[execute] isValidSignature(bytes32) result:', sigResult)
  } catch (e) {
    console.log('[execute] isValidSignature(bytes32) error:', String(e).slice(0, 300))
  }
  // -- END DEBUG --

  const safe = await Safe.init({
    provider: RPC_URL,
    signer: RELAYER_PRIVATE_KEY,
    safeAddress,
    contractNetworks: { [String(CHAIN.id)]: { ...SAFE_ADDRESSES, safeWebAuthnSignerFactoryAddress: WEBAUTHN_SIGNER_FACTORY, safeWebAuthnSharedSignerAddress: WEBAUTHN_SHARED_SIGNER } },
  })

  const signedTx = await safe.copyTransaction(safeTransaction as any)
  signedTx.addSignature(new EthSafeSignature(signerAddress, webauthnSig, true))

  const result = await safe.executeTransaction(signedTx)
  const receipt = await (result.transactionResponse as any)?.wait()
  return receipt?.hash ?? (result.transactionResponse as any)?.hash
}

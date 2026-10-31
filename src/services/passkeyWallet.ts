import Safe, { SafeFactory, EthSafeSignature } from '@safe-global/protocol-kit'
import {
  createPublicClient,
  createWalletClient,
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
import { privateKeyToAccount } from 'viem/accounts'
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
  {
    name: 'createSigner',
    type: 'function',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: 'signer', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getSigner',
    type: 'function',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: 'signer', type: 'address' }],
    stateMutability: 'view',
  },
] as const

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })

function relayerClient() {
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY)
  return { client: createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) }), account }
}

// Combine P-256 verifier address into the uint176 verifiers field Safe expects
function buildVerifiers(): bigint {
  // verifiers = P256_VERIFIER address packed into uint176
  return BigInt(P256_VERIFIER)
}

export async function getPasskeySignerAddress(x: bigint, y: bigint): Promise<Address> {
  const verifiers = buildVerifiers()
  const address = await publicClient.readContract({
    address: WEBAUTHN_SIGNER_FACTORY,
    abi: signerFactoryAbi,
    functionName: 'getSigner',
    args: [x, y, verifiers],
  })
  return address
}

export async function deployPasskeySignerIfNeeded(x: bigint, y: bigint): Promise<Address> {
  const verifiers = buildVerifiers()
  const signerAddress = await getPasskeySignerAddress(x, y)

  // Check if already deployed
  const code = await publicClient.getCode({ address: signerAddress })
  if (code && code !== '0x') return signerAddress

  // Deploy via factory
  const { client, account } = relayerClient()
  await client.writeContract({
    address: WEBAUTHN_SIGNER_FACTORY,
    abi: signerFactoryAbi,
    functionName: 'createSigner',
    args: [x, y, verifiers],
    account,
    chain: CHAIN,
  })

  return signerAddress
}

export async function deploySafe(passkeyX: bigint, passkeyY: bigint): Promise<Address> {
  const signerAddress = await deployPasskeySignerIfNeeded(passkeyX, passkeyY)

  const safeFactory = await SafeFactory.init({
    provider: RPC_URL,
    signer: RELAYER_PRIVATE_KEY,
    contractNetworks: {
      [String(CHAIN.id)]: {
        ...SAFE_ADDRESSES,
        safeWebAuthnSignerFactoryAddress: WEBAUTHN_SIGNER_FACTORY,
        safeWebAuthnSharedSignerAddress: WEBAUTHN_SHARED_SIGNER,
      },
    },
  })

  const safeConfig = {
    owners: [signerAddress],
    threshold: 1,
  }

  // Check if already deployed
  const predictedAddress = await safeFactory.predictSafeAddress(safeConfig)
  const code = await publicClient.getCode({ address: predictedAddress as Address })
  if (code && code !== '0x') return predictedAddress as Address

  // Deploy
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
  const fullSig = buildContractSignature(signerAddress, webauthnSig)

  const safe = await Safe.init({
    provider: RPC_URL,
    signer: RELAYER_PRIVATE_KEY,
    safeAddress,
    contractNetworks: { [String(CHAIN.id)]: { ...SAFE_ADDRESSES, safeWebAuthnSignerFactoryAddress: WEBAUTHN_SIGNER_FACTORY, safeWebAuthnSharedSignerAddress: WEBAUTHN_SHARED_SIGNER } },
  })

  // Add the passkey signature to the transaction
  const signedTx = await safe.copyTransaction(safeTransaction as any)
  signedTx.addSignature(new EthSafeSignature(signerAddress, fullSig, true))

  const result = await safe.executeTransaction(signedTx)
  const receipt = await (result.transactionResponse as any)?.wait()
  return receipt?.hash ?? (result.transactionResponse as any)?.hash
}

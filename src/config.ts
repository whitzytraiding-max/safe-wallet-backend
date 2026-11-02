import { arbitrumSepolia } from 'viem/chains'

export const CHAIN = arbitrumSepolia

export const RPC_URL =
  process.env.ALCHEMY_RPC_URL ||
  'https://sepolia-rollup.arbitrum.io/rpc'

export const SAFE_TX_SERVICE_URL =
  'https://safe-transaction-arbitrum-sepolia.safe.global'

// Safe v1.4.1 canonical deployment addresses (same across all EVM chains)
export const SAFE_ADDRESSES = {
  safeSingletonAddress:        '0x41675C099F32341bf84BFc5382aF534df5C7461a' as const,
  safeProxyFactoryAddress:     '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as const,
  multiSendAddress:            '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526' as const,
  multiSendCallOnlyAddress:    '0x9641d764fc13c8B624c04430C7356C1C7C8102e2' as const,
  fallbackHandlerAddress:      '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99' as const,
  signMessageLibAddress:       '0xd53cd0aB83D845Ac265BE939c57F53AD838012c9' as const,
  createCallAddress:           '0x9b35Af71d77eaf8d7e40252370304687390A1A52' as const,
  simulateTxAccessorAddress:   '0x3d4BA2E0884aa488718476ca2FB8Efc291A46199' as const,
}

// Safe WebAuthn signer factory (deployed via CREATE2, same address on all chains)
export const WEBAUTHN_SIGNER_FACTORY = '0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf' as const
export const WEBAUTHN_SHARED_SIGNER  = '0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9' as const

// P-256 (secp256r1) verifier — Daimo pure-Solidity verifier (same address across chains via CREATE2)
// The EIP-7212 precompile at 0x100 is NOT active on Arbitrum Sepolia
export const P256_VERIFIER = '0xc2b78104907F722DABAc4C69f826a522B2754De4' as const

export const RELAYER_PRIVATE_KEY = (process.env.RELAYER_PRIVATE_KEY || '') as `0x${string}`

// ERC-20 tokens on Arbitrum Sepolia (testnet versions)
export const TOKENS = {
  USDC: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as const,
  ARB:  '0x912CE59144191C1204E64559FE8253a0e49E6548' as const, // mainnet ARB (testnet may differ)
}

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { walletRouter } from './routes/wallet.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', chain: 'arbitrum-sepolia' }))
app.use('/api/wallet', walletRouter)

app.listen(PORT, () => {
  console.log(`Safe Wallet backend running on :${PORT}`)
  console.log(`Chain: Arbitrum Sepolia (421614)`)
  if (!process.env.RELAYER_PRIVATE_KEY) {
    console.warn('⚠️  RELAYER_PRIVATE_KEY not set — wallet deployment will fail')
    console.warn('   Copy .env.example to .env and add a funded Arbitrum Sepolia key')
  }
})

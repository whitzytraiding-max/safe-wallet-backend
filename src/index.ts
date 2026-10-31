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

// Local dev: start server directly. Vercel: export app as default handler.
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Safe Wallet backend running on :${PORT}`)
    if (!process.env.RELAYER_PRIVATE_KEY) {
      console.warn('⚠️  RELAYER_PRIVATE_KEY not set — wallet deployment will fail')
    }
  })
}

export default app

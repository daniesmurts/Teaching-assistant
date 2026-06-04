import { Pool } from 'pg'
import { logger } from '../lib/logger'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

pool.on('error', (err) => {
  logger.error({ message: 'Unexpected PostgreSQL pool error', error: err.message })
})

import { defineConfig } from 'drizzle-kit'

// Generation only (`npx drizzle-kit generate`). Apply with `npx tsx --env-file=.env.local scripts/migrate.ts`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? '' },
})

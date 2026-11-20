# Run OncoSetu locally on Windows (no Docker)

This gives you a private copy of the app on your own machine with its own throwaway database.
It never touches the live Neon database or the live site. Run the commands in Git Bash.

Ports: app **3000**, local Postgres **54600**.

## One-time setup

1. Create the database launcher folder (outside the repo):

```bash
mkdir -p "/c/Users/GARV BANSAL/Documents/onco-localdb" && cd "/c/Users/GARV BANSAL/Documents/onco-localdb"
echo '{"name":"onco-localdb","private":true,"type":"module"}' > package.json
npm i embedded-postgres
cat > start-db.mjs <<'EOF'
// Starts a local Postgres on port 54600 (data in ./data). Ctrl+C to stop.
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('./data', import.meta.url))
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 54600, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'] })
const fresh = !existsSync(dir + '/PG_VERSION')
if (fresh) await pg.initialise()
await pg.start()
if (fresh) await pg.createDatabase('oncosetu')
console.log('READY postgres://postgres:postgres@localhost:54600/oncosetu')
const stop = async () => { await pg.stop(); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)
EOF
```

2. Start the database (leave it running; `nohup` keeps it in the background):

```bash
cd "/c/Users/GARV BANSAL/Documents/onco-localdb" && (nohup node start-db.mjs > db.log 2>&1 &)
tail -2 db.log   # wait for the line starting with READY
```

3. Create `.env.local` in the repo (it is git-ignored; never commit it). From the repo root:

```bash
node -e "
const c=require('crypto');const b=()=>c.randomBytes(32).toString('base64');
const {privateKey}=c.generateKeyPairSync('ed25519');
const pem=privateKey.export({type:'pkcs8',format:'pem'});
const u='postgres://postgres:postgres@localhost:54600/oncosetu';
require('fs').writeFileSync('.env.local',[
'DATABASE_URL='+u,'DATABASE_URL_UNPOOLED='+u,
'APP_MASTER_KEY='+b(),'HMAC_KEY='+b(),'BACKUP_KEY='+b(),
'SIGNING_KEY_ED25519='+Buffer.from(pem).toString('base64'),'SIGNING_KEY_ID=k-local',
'DEMO_MODE=true','PUBLIC_BASE_URL=http://localhost:3000','CRON_SECRET='+c.randomBytes(24).toString('hex'),''].join('\n'))"
```

   No Gemini key is set, so extraction uses the rule-based fallback (fine for local work).
   `DATABASE_URL_APP` (the restricted app role) is added to `.env.local` automatically by the migrate step.

4. Install, migrate, seed:

```bash
npm install
npx tsx --env-file=.env.local scripts/migrate.ts
npx tsx --env-file=.env.local scripts/check-migrations.mts
npx tsx --env-file=.env.local scripts/seed-base.ts
```

5. Build and start the app, then seed the demo data:

```bash
npm run build
(nohup npx next start -p 3000 > next.log 2>&1 &)
npx tsx --env-file=.env.local scripts/seed-demo.ts --base http://localhost:3000
```

Open http://localhost:3000/login (demo staff panel; password `Demo@2026`) and http://localhost:3000/p/login (patient portal; the OTP shows in the "Demo phone" drawer).

## Start (every later day)

```bash
cd "/c/Users/GARV BANSAL/Documents/onco-localdb" && (nohup node start-db.mjs > db.log 2>&1 &)
cd "/c/Users/GARV BANSAL/Documents/onco" && (nohup npx next start -p 3000 > next.log 2>&1 &)
```

After changing code, run `npm run build` again before starting (or use `npm run dev` for hot reload).

## Stop

```bash
# app (port 3000) and database (port 54600): find the process ids and kill them
for p in 3000 54600; do
  pid=$(netstat -ano | grep ":$p " | grep LISTENING | awk '{print $5}' | head -1)
  [ -n "$pid" ] && taskkill //PID $pid //F //T
done
```

Stopping the database with `taskkill //T` is safe for a throwaway copy. If Postgres complains on the next start, delete the `data` folder in `onco-localdb` and redo steps 2, 4 and 5.

## Reseed / reset

Add demo data again (safe to repeat): `npx tsx --env-file=.env.local scripts/seed-demo.ts --base http://localhost:3000` (the app must be running).

Full reset (wipes the local copy only):

```bash
# 1. stop app + database (above)
rm -rf "/c/Users/GARV BANSAL/Documents/onco-localdb/data"
# 2. start the database again (creates an empty one), then:
sed -i '/^DATABASE_URL_APP=/d' .env.local   # the new empty DB has a new app-role password; migrate re-creates this line
npx tsx --env-file=.env.local scripts/migrate.ts
npx tsx --env-file=.env.local scripts/seed-base.ts
# 3. start the app, then run seed-demo.ts as above
```

Safety: every command above uses `--env-file=.env.local`, which points only at `localhost:54600`. Never copy production values (from `vercel env pull`) into `.env.local`.

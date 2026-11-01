import { closeDb } from '../../src/db'
import { Api, registerPatient, uploadDemo, waitDoc } from './helpers/api'
import { documentsOf, eventsOf, missingOf } from './helpers/db'

async function main() {
  const files = process.argv.slice(3)
  const key = (process.argv[2] ?? 'hero') as 'hero' | 'returning' | 'fulfilled'
  const rec = await Api.login('records')
  const p = await registerPatient(rec, { base: key })
  console.log('patient', p.id)
  const t0 = Date.now()
  const ups = await Promise.all(files.map((f) => uploadDemo(rec, p.id, f)))
  const docs = await Promise.all(ups.map((u) => waitDoc(rec, u.documentId)))
  console.log('processed in', Math.round((Date.now() - t0) / 1000), 's')
  for (const [i, f] of files.entries()) console.log(f, docs[i].status, docs[i].docType, docs[i].identity, JSON.stringify(docs[i].flags), 'events', docs[i].events)
  for (const e of await eventsOf(p.id)) console.log('EV', e.eventType, e.eventDate, e.datePrecision, JSON.stringify(e.fields), JSON.stringify(e.flags), e.dateFlags, e.id.slice(0, 8), e.documentId?.slice(0, 8))
  for (const m of await missingOf(p.id)) console.log('MISS', m.ruleId, m.mode, m.state, m.dedupeKey, JSON.stringify(m.matchWindow).slice(0, 300))
  for (const d of await documentsOf(p.id)) console.log('DOC', d.id.slice(0, 8), d.docType, d.documentDate, d.institutionName, d.identityResult, d.attachState, d.status, d.amendmentOf, d.handwritten, d.lowConfidence, d.injectionFlag, d.pages)
  await rec.dispose()
}
main().then(closeDb).catch(async (e) => { console.error(e); await closeDb(); process.exit(1) })

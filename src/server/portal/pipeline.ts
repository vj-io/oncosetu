// The only place the portal touches the Pipeline agent's modules (docs/ARCHITECTURE.md "Cross-feature interfaces").
// If src/server/pipeline/* does not exist yet, this file is the one thing that fails to compile.
export { ingestDocument, scheduleBatch, scheduleProcessing } from '@/server/pipeline/ingest'
export { recomputeRadar } from '@/server/pipeline/radar'

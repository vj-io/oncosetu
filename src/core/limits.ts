// Upload limits, in one place. The browser splits anything over CHUNK_BYTES into chunks (a Vercel request body is capped
// at 4.5 MB), the server joins them and checks size and checksum before the normal safety scan and intake.
export const MB = 1024 * 1024
/** One uploaded file (a ZIP is limited separately). */
export const MAX_FILE_BYTES = 50 * MB
/**
 * One ZIP file as uploaded, the most all its entries may add up to once opened (a zip-bomb guard), and the most files in it.
 * Sized for a real imaging CD (a study is 700 to 2,600 slices, 40 to 150 MB zipped). The server and the browser pre-check apply
 * these same numbers through one rule (src/lib/zip-check.ts).
 */
export const MAX_ZIP_BYTES = 300 * MB
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1536 * MB
export const MAX_ZIP_ENTRIES = 3000
/** One study kept as a single stored document (its slices bundled): never more than this, so one database row stays well under Postgres' 1 GB value limit. */
export const MAX_STUDY_BUNDLE_BYTES = MAX_ZIP_BYTES
/** An entry that expands more than this many times is refused. */
export const MAX_ZIP_RATIO = 200
/** Size of one chunk sent by the browser (stays well under the 4.5 MB request limit, multipart overhead included). */
export const CHUNK_BYTES = 3.5 * MB
/** Largest single plain request body for the old one-shot upload. */
export const ONE_SHOT_BYTES = 4 * MB
/** Database storage an upload may fill up to (files live in Postgres; Neon's free plan stops writes at 512 MB). */
export const STORAGE_BUDGET_BYTES = Number(process.env.STORAGE_BUDGET_MB ?? 450) * MB
/** Largest picture the DICOM preview will draw (4096 x 4096); bigger headers get the "file stored" note instead. */
export const MAX_PREVIEW_PIXELS = 4096 * 4096
/** A started chunked upload expires after this long. */
export const UPLOAD_SESSION_HOURS = 6

export const UPLOAD_LIMIT_TEXT = { file: `${MAX_FILE_BYTES / MB} MB`, zip: `${MAX_ZIP_BYTES / MB} MB` }

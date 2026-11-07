// Plain constants, deliberately NOT in a "use client" file: server components import these, and a client module's non-component
// exports arrive in server code as undefined.
/** The exact one-line explanations, shared so every screen says the same thing. */
export const EXPLAIN = {
  ledger: "What arrived after the last sealed visit. Grouped by kind and ordered by date, never by importance.",
  completeness: "Papers that other papers mention but that are not in this file. “Not in file” means we do not hold it, not that it was not done.",
  quote: "Opens the original page with this sentence highlighted.",
  wrongPatient: "This report’s name, age or sex does not match this patient. It stays out of the record until a person decides.",
  hiddenInstructions: "This PDF had invisible text addressed to software. It was stripped and ignored; nothing in a document can change a status.",
  handwriting: "Handwriting is kept as the original picture. The software does not guess at it, so nothing from it is indexed.",
  seal: "A fingerprint of the record as it stood at that visit. Anyone can check it has not changed since.",
  audit: "Every view and change is logged in a chain that cannot be edited without breaking it.",
  diagnosis: "Copied word for word from the document. OncoSetu does not decide or check the diagnosis.",
  letter: "A ready-to-print request for the missing papers, in English or Hindi, for the other hospital’s records department.",
  share: "A link to the sealed record that opens only with a passcode and stops working on the date you choose. It carries the document list, not a clinical summary.",
  breakGlass: "Emergency access to a record without consent. A reason is required, the patient is told, and it is listed for the administrator.",
  firstLook: "Everything a doctor needs before the patient sits down: what is new, what is missing, what a person still has to check. Counts and quotes only.",
  oncology: "The same facts, re-ordered the way a cancer record is read. Each line is copied from a document; nothing is worked out by the software.",
} as const;

# ADR-016: Provider interfaces for intake channels, OCR and speech

Status: accepted for the prototype · 8 Nov 2026 · Requirements: FR-ING-09, FR-DOC-02, FR-VOX-03 (PRD §6, §8)

## Context

The PRD keeps two outside dependencies swappable: the channels that bring documents in (FR-ING-09: an ABDM PHR app such
as Eka Care could deliver patient-forwarded documents under the same consent) and OCR (FR-DOC-02: optional cloud document
AI behind an interface; SPIKE-OCR picks the default). The prototype had neither interface in code. Both are now small
TypeScript interfaces beside their only callers, with the existing code as the first implementations. No behaviour changed.

## Decision

### `IntakeProvider` (`src/server/pipeline/ingest.ts`)

```ts
interface IntakeProvider<Payload, Reply> {
  readonly route: IntakeRoute            // stored as documents.intake_route
  receive(payload: Payload, requestId: string): Promise<Reply>
}
```

A channel's route handler authenticates the caller (Basic auth for the Postmark email drop, the Twilio signature for
WhatsApp, a signed request for a partner) and passes the parsed payload to `receive`, which must:

1. resolve the patient and a sender that staff verified in person for that patient (a name in the payload proves nothing);
2. check the patient's active `store` consent at the moment of use;
3. send every file through `ingestDocument` with `route`, so the size limit, type sniff, safety scan (EICAR refusal,
   active-content PDFs), dedupe and audit rows are the same as for any upload;
4. call `scheduleProcessing` only after its transaction has committed; audit with ids only.

Implementations: `emailIntake` (`src/server/inbound/email.ts`) and `whatsappIntake` (`src/server/inbound/whatsapp.ts`);
both webhook routes call `receive`. Staff uploads, the patient upload link and offline sync are screens of this app with
their own session and call `ingestDocument` directly; they are not providers. A PHR partner would be a third
implementation with its own `intake_route` value (the column is text, so no migration). Nothing beyond the interface is
built for it in v1.0, as FR-ING-09 says.

### `OcrProvider` (`src/server/pipeline/text.ts`)

```ts
interface OcrProvider {
  readonly name: string; readonly version: string    // written to document_pages.processor / processor_version
  recognize(image: Buffer, langs: 'eng+hin' | 'eng'): Promise<OcrResult>
}
// OcrResult: text built line by line; words with box and char offsets into text; per-line word confidences; mean confidence
```

`tesseractOcr` (tesseract.js 7, eng+hin) is the only implementation and the default for every scanned page. The policy
around it stays provider-independent in `ocrPage`: the English-only re-read when no Devanagari word is confidently read,
the handwriting classifier, and the low-confidence flag.

A cloud document AI added later needs a selection point (an env var, like `llmProvider()`), and because page images
would leave the system it must be gated exactly like the LLM path: the org's AI flag, the patient's `ai` consent purpose,
and an India-region endpoint (PRD §6.8 data residency). Pages it reads record its own name and version.

### `AsrProvider` (`src/server/voice/provider.ts`)

```ts
type AsrProvider = { name: string; model: string; transcribe(audio: Blob, lang: Lang, keyterms?: readonly string[]): Promise<string> }
```

`asr` is Sarvam (`saaras:v4`; codemix for Hindi, translit for Hinglish) with keyterms: the patient's own medicines and
hospitals from their record, then the formulary. The browser's Web Speech recogniser is the no-key fallback; it runs in
the browser, so it is recorded by name (`browser-webspeech`) rather than implemented on the server. Statements, kept
recordings (`voice_clips`) and the audit row carry the provider and model that heard the answer. A new provider is only
used for real patients after its drug-name error rate is measured (`scripts/eval-asr.ts`, then shadow-phase clips).

## Consequences

- A new channel or OCR engine is one module implementing one interface; the pipeline and the safety checks do not change.
- Each interface has one or two implementations today, so it stays a plain type, not a registry or a factory.
- The contract above is the reviewable part: a new provider is checked against its numbered duties, not against the code.

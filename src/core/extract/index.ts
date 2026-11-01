// No-LLM extraction path: classify → header → patterns → injection flags. Output mirrors `extraction.v1`
// so the pipeline treats LLM and fallback output identically (both go through runGate).
import type { Candidate } from '../gate'
import type { DocType } from '../types'
import { classifyDocument, type Classification } from './classify'
import { parseHeader, type ParsedHeader } from './header'
import { detectInjection, type InjectionResult } from './injection'
import { extractPatterns, type ExtractPage } from './patterns'
import { EXTRACTION_SCHEMA_VERSION, type Extraction } from './schema'

export * from './classify'
export * from './header'
export * from './injection'
export * from './patterns'
export * from './schema'

export interface FallbackExtraction extends Extraction {
  items: (Extraction['items'][number] & Candidate)[]
  classification: Classification
  /** Header fields with raw offsets into page 1 (FR-ID-03 evidence spans). */
  headerSpans: ParsedHeader
  injection: InjectionResult
}

/** Runs the deterministic extractor. `docType` overrides the classifier (e.g. staff tag or handwriting classifier). */
export function extractFallback(pages: ExtractPage[], docType?: DocType): FallbackExtraction {
  const sorted = [...pages].sort((a, b) => a.pageNo - b.pageNo)
  const classification = classifyDocument(sorted.map((p) => p.text))
  const type = docType ?? classification.docType
  const headerSpans = parseHeader(sorted[0]?.text ?? '')
  const v = (s?: { value: string }) => s?.value ?? null
  return {
    schema_version: EXTRACTION_SCHEMA_VERSION,
    doc_type: type,
    header: {
      name: v(headerSpans.name),
      age: v(headerSpans.age),
      sex: v(headerSpans.sex),
      dob: v(headerSpans.dob),
      mrn: v(headerSpans.mrn),
      report_date: v(headerSpans.reportDate),
      institution: v(headerSpans.institution),
      referring_doctor: v(headerSpans.referringDoctor),
    },
    items: extractPatterns(sorted, type, headerSpans) as FallbackExtraction['items'],
    classification,
    headerSpans,
    injection: detectInjection(sorted.map((p) => p.text).join('\n')),
  }
}

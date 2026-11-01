// Radar rule library. RULES_YAML is byte-identical to rules.yaml (enforced by radar.test.ts) so the runtime
// never reads the filesystem. Edit rules.yaml, then paste it here.
import { parse } from 'yaml'
import { z } from 'zod'
import { DOC_TYPES, EVENT_TYPES } from '../types'

export const RuleSchema = z
  .object({
    id: z.string().regex(/^RAD-[A-Z0-9-]+$/),
    version: z.number().int().positive(),
    clinician_reviewed: z.boolean(),
    kind: z.enum(['window', 'prior_cycles']).default('window'),
    trigger: z
      .object({
        event_type: z.enum(EVENT_TYPES),
        required_fields: z.array(z.string()).default([]),
        keywords_any: z.record(z.string(), z.array(z.string()).min(1)).optional(),
        keywords_none: z.record(z.string(), z.array(z.string()).min(1)).optional(),
      })
      .strict(),
    expects: z
      .object({
        document_types: z.array(z.enum(DOC_TYPES)).min(1),
        document_types_from_test: z.boolean().default(false),
        window_days: z.tuple([z.number().int(), z.number().int()]).refine(([a, b]) => a <= b, 'window_days must be [from, to] with from <= to'),
        same_institution_preferred: z.boolean().default(false),
      })
      .strict(),
    wording: z.object({ en: z.string().min(1), hi: z.string().min(1) }).strict(),
  })
  .strict()
export type RadarRule = z.infer<typeof RuleSchema>

/** Parses and validates a rule library (YAML list). Throws with the zod issues on invalid input or duplicate ids. */
export function loadRules(yamlText: string): RadarRule[] {
  const rules = z.array(RuleSchema).min(1).parse(parse(yamlText))
  const ids = new Set<string>()
  for (const r of rules) {
    if (ids.has(r.id)) throw new Error(`duplicate radar rule id ${r.id}`)
    ids.add(r.id)
  }
  return rules
}

export const RULES_YAML = `# Missing-Record Radar — document-completeness checklist (PRD §6.5, Appendix F).
# Wording is about documents only (FR-RAD-04). Every rule runs in shadow mode until a clinician reviews it
# (FR-RAD-05). Keep src/core/radar/rules.ts (RULES_YAML) byte-identical to this file; a test enforces it.
#
# trigger.keywords_any / keywords_none: field -> words (case-insensitive whole words; "*ectomy" = any word ending in "ectomy").
# trigger.required_fields: "event_date" means the trigger has a date (event date, else document date).
# expects.window_days: [from, to] days relative to the trigger date (negative = before).
# Placeholders: {event_date} {source_label} {test} {scan} {institution} {missing_list}

- id: RAD-SURG-HPE-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: procedure_documented
    required_fields: [procedure_text, event_date]
    keywords_any:
      procedure_text: [excision, resection, "*ectomy", biopsy, lumpectomy, mastectomy, "wide local excision", MRM, WLE, BCS, FNAC, TURBT]
  expects:
    document_types: [pathology_report]
    window_days: [0, 60]
    same_institution_preferred: true
  wording:
    en: "Histopathology report not in file for the procedure documented on {event_date} ({source_label})."
    hi: "{event_date} को दर्ज प्रक्रिया की हिस्टोपैथोलॉजी रिपोर्ट फ़ाइल में नहीं है ({source_label})।"

- id: RAD-HPE-IHC-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: report_pending_documented
    required_fields: [test_name, event_date]
    keywords_any:
      test_name: [IHC, immunohistochemistry, ER, PR, HER2, HER-2, Ki-67, Ki67]
  expects:
    document_types: [ihc_molecular_report]
    window_days: [0, 45]
    same_institution_preferred: true
  wording:
    en: "IHC report mentioned as pending on {event_date} is not in file ({source_label})."
    hi: "{event_date} को लंबित बताई गई आईएचसी रिपोर्ट फ़ाइल में नहीं है ({source_label})।"

- id: RAD-PEND-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: report_pending_documented
    required_fields: [test_name, event_date]
    keywords_none:
      test_name: [IHC, immunohistochemistry, ER, PR, HER2, HER-2, Ki-67, Ki67]
  expects:
    document_types: [pathology_report, ihc_molecular_report, imaging_report, lab_report]
    document_types_from_test: true
    window_days: [0, 60]
    same_institution_preferred: false
  wording:
    en: "{test} report mentioned as pending on {event_date} is not in file ({source_label})."
    hi: "{event_date} को लंबित बताई गई {test} रिपोर्ट फ़ाइल में नहीं है ({source_label})।"

- id: RAD-ADM-DS-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: admission_documented
    required_fields: [event_date]
  expects:
    document_types: [discharge_summary]
    window_days: [0, 30]
    same_institution_preferred: true
  wording:
    en: "Discharge summary not in file for the admission documented on {event_date} ({source_label})."
    hi: "{event_date} को दर्ज भर्ती का डिस्चार्ज सारांश फ़ाइल में नहीं है ({source_label})।"

- id: RAD-CHEMO-PRIOR-01
  version: 1
  clinician_reviewed: false
  kind: prior_cycles
  trigger:
    event_type: chemotherapy_session_documented
    required_fields: [cycle_number]
  expects:
    document_types: [chemo_daycare_record]
    window_days: [-3650, 0]
    same_institution_preferred: false
  wording:
    en: "Chemotherapy records for cycles {missing_list} are not in file ({source_label})."
    hi: "कीमोथेरेपी चक्र {missing_list} के रिकॉर्ड फ़ाइल में नहीं हैं ({source_label})।"

- id: RAD-RT-SUM-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: radiotherapy_documented
    required_fields: [status_text, event_date]
    keywords_any:
      status_text: [completed, complete, completion, concluded, finished]
  expects:
    document_types: [radiotherapy_summary]
    window_days: [0, 30]
    same_institution_preferred: true
  wording:
    en: "Radiotherapy summary not in file for treatment documented as completed on {event_date} ({source_label})."
    hi: "{event_date} को पूरा दर्ज किए गए उपचार का रेडियोथेरेपी सारांश फ़ाइल में नहीं है ({source_label})।"

- id: RAD-IMG-PT-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: patient_statement
    required_fields: [scan_name]
  expects:
    document_types: [imaging_report]
    window_days: [-30, 30]
    same_institution_preferred: false
  wording:
    en: "Report for the {scan} the patient mentioned is not in file ({source_label})."
    hi: "मरीज़ द्वारा बताए गए {scan} की रिपोर्ट फ़ाइल में नहीं है ({source_label})।"

- id: RAD-REF-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: referral_documented
    required_fields: [referred_to_text, event_date]
  expects:
    document_types: [consult_note]
    window_days: [0, 90]
    same_institution_preferred: false
  wording:
    en: "Note from the referral to {institution} documented on {event_date} is not in file ({source_label})."
    hi: "{event_date} को दर्ज {institution} को रेफ़रल का नोट फ़ाइल में नहीं है ({source_label})।"

- id: RAD-RX-OUT-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: patient_statement
    required_fields: [medication_names]
  expects:
    document_types: [prescription_printed, prescription_handwritten]
    window_days: [-30, 30]
    same_institution_preferred: false
  wording:
    en: "Prescription the patient mentioned from {institution} is not in file ({source_label})."
    hi: "मरीज़ द्वारा बताया गया {institution} का पर्चा फ़ाइल में नहीं है ({source_label})।"

- id: RAD-MOL-01
  version: 1
  clinician_reviewed: false
  trigger:
    event_type: molecular_test_documented
    required_fields: [test_name, status_text, event_date]
    keywords_any:
      status_text: [sent, dispatched]
  expects:
    document_types: [ihc_molecular_report]
    window_days: [0, 60]
    same_institution_preferred: true
  wording:
    en: "{test} report for the sample documented as sent on {event_date} is not in file ({source_label})."
    hi: "{event_date} को भेजे गए नमूने की {test} रिपोर्ट फ़ाइल में नहीं है ({source_label})।"
`

export const RADAR_RULES: readonly RadarRule[] = loadRules(RULES_YAML)

/**
 * THIRD HELD-OUT (blind) evaluation set: 24 documents for 6 new fictional patients + hand-authored gold. Written on
 * 9 Nov 2026 by a separate author who did NOT see the extraction rules (src/server/pipeline, src/server/ai, src/core),
 * the eval scripts, the eval reports or the regression tests; only the generator engine, the two earlier held-out
 * document files, generate-heldout2.ts and the two earlier gold files were read, to copy the format and the labelling
 * convention. Weighted to cancers and departments the earlier sets barely cover: ALK-positive lung adenocarcinoma
 * (Goa), rectal cancer with colonoscopy, MRI and short-course RT (Karnataka), papillary thyroid cancer with radioiodine
 * (Uttarakhand), paediatric B-ALL with a bone-marrow report (Andhra Pradesh), metastatic prostate cancer with a bone
 * scan (Himachal Pradesh) and a young adult with a testicular germ cell tumour (Jharkhand).
 * Everything is FICTIONAL (institutions, doctors, patients, numbers, .example domains); every page carries the
 * "SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY" footer. PDFs use Helvetica (WinAnsi): Devanagari only on photographed JPEGs.
 */
import type { Inst, Sig } from './engine'
import { END, grid, h, HEAD, handwrittenRx, kv, p, sig, table, title, ul, type HeldDoc } from './heldout-docs'

export type { Gold, GoldEvent, HeldDoc } from './heldout-docs'

export const GOLD_ABOUT =
  'Hand-authored gold for the THIRD HELD-OUT set in data/eval/heldout3, written 9 Nov 2026 by a separate author from the document definitions in scripts/demo-docs/heldout3-docs.ts, without seeing the extraction rules (blind). Same convention as data/eval/gold-heldout2.json. ' +
  'One entry per fact a records officer would list, restricted to PRD §7.2 event types. `date` = the event\'s own date (YYYY-MM-DD); `match` = text that must appear in the extracted quote or fields (case-insensitive). ' +
  'Prescriptions and discharge medication lists: one entry per medication (medicines named only in a history, an advice line or a chemotherapy administration table are not prescriptions). ' +
  'A study, specimen, procedure or chemotherapy dose the document only refers to is listed when the document gives it its own date or says its report is awaited ("sent for HPE" counts); planned or future events (tentative surgery, next cycle, review dates) are not facts. ' +
  'Radiotherapy courses carry no date (external beam and brachytherapy are separate courses). Handwritten prescriptions list none (never auto-extracted). ' +
  'Quote-only facts: every stage statement (clinical or pathological), every statement of a pathological resection-margin result wherever it appears (radiotherapy planning margins and intended surgical margins in an operation note are not margin facts), every marker result row of an IHC report, the conclusion of an imaging report (Impression / Opinion) and a consultation section headed Impression, and the regimen line of a chemotherapy record (a regimen given concurrently with radiotherapy or planned in a note is not labelled). Headings "Diagnosis" / "Final diagnosis" are not impressions. ' +
  '`identity` is the expected header decision against the patient in patients.json (a handwritten header is `insufficient` and held); `held` = the document must not reach the record without a person\'s decision.'

// ---------------------------------------------------------------- patients (all invented)
export const heldPatients = [
  { patientKey: 'rosalind', fullName: 'Rosalind Maria Fernandes', aliases: ['Rosalind Fernandes', 'Mrs. R. M. Fernandes', 'ROSALIND M. FERNANDES'], sex: 'female', dob: '1977-09-22', phone: '+91 98221 40573', preferredLanguage: 'en', registeringOrg: 'Mandovi Cancer Institute' },
  { patientKey: 'raghavendra', fullName: 'Raghavendra Venkatesh Shetty', aliases: ['Raghavendra Shetty', 'Mr. R. V. Shetty', 'RAGHAVENDRA V. SHETTY'], sex: 'male', dob: '1966-07-03', phone: '+91 98450 72318', preferredLanguage: 'en', registeringOrg: 'Netravati Gastro & Cancer Hospital' },
  { patientKey: 'nandita', fullName: 'Nandita Rawat', aliases: ['Ms. Nandita Rawat', 'N. Rawat', 'नंदिता रावत'], sex: 'female', dob: '1991-10-19', phone: '+91 94120 58361', preferredLanguage: 'hi', registeringOrg: 'Rispana Surgical & Endocrine Centre' },
  { patientKey: 'saiteja', fullName: 'Pothula Venkata Sai Teja', aliases: ['P. V. Sai Teja', 'Master Sai Teja', 'SAI TEJA POTHULA'], sex: 'male', dob: '2018-02-11', phone: '+91 98490 61537', preferredLanguage: 'en', registeringOrg: "Rushikonda Children's Cancer Centre" },
  { patientKey: 'deviram', fullName: 'Devi Ram Chauhan', aliases: ['D. R. Chauhan', 'Mr. Devi Ram', 'देवी राम चौहान'], sex: 'male', dob: '1953-05-08', phone: '+91 94180 36294', preferredLanguage: 'hi', registeringOrg: 'Jakhoo Hills Urology & Cancer Centre' },
  { patientKey: 'amit', fullName: 'Amit Kumar Munda', aliases: ['Amit Munda', 'A. K. Munda', 'Amit K. Munda'], sex: 'male', dob: '2003-12-01', phone: '+91 97710 48253', preferredLanguage: 'hi', registeringOrg: 'Subarnarekha Cancer Hospital' },
]

// ---------------------------------------------------------------- institutions (all invented)
const J = {
  mandovi: { name: 'MANDOVI CANCER INSTITUTE', sub: 'Thoracic Oncology  |  Medical Oncology  |  Radiation Oncology', addr: 'Dayanand Bandodkar Marg, Campal, Panaji, Goa 403 001', contact: 'Tel: 0832-2438 600  |  Email: mo.opd@mandovi-cancer.example', reg: 'Reg. No. GA/NG/HOSP/2013/0058', accent: [0.0, 0.35, 0.5], shape: 'circle' },
  kamat: { name: 'DR. SAMEER KAMAT', sub: 'M.D., D.M. (Medical Oncology)  |  Consultant Thoracic & Medical Oncologist', addr: 'Mandovi Cancer Institute, Campal, Panaji, Goa 403 001', contact: 'Tel: 0832-2438 600  |  OPD: Mon - Fri 9:30 am - 1:30 pm  |  Reg. No. GMC-4471', accent: [0.0, 0.35, 0.5], shape: 'circle' },
  aguada: { name: 'AGUADA IMAGING & NUCLEAR MEDICINE', sub: 'PET-CT  |  SPECT-CT  |  CT  |  MRI', addr: 'Alto Porvorim, Bardez, Goa 403 521', contact: 'Tel: 0832-2417 090  |  Email: petct@aguada-imaging.example', reg: 'AERB Reg. No. GA/NM/2019/0012', accent: [0.45, 0.15, 0.4], shape: 'diamond' },
  zuari: { name: 'ZUARI HISTOPATHOLOGY & MOLECULAR LABORATORY', sub: 'Surgical Pathology  |  Immunohistochemistry  |  Molecular Diagnostics', addr: '2nd Floor, Colva Road, Margao, Goa 403 601', contact: 'Tel: 0832-2731 455  |  Email: reports@zuari-histo.example', reg: 'Lab Reg. No. GA/SG/PL/2016/0031', accent: [0.15, 0.4, 0.2], shape: 'square' },
  netravati: { name: 'NETRAVATI GASTRO & CANCER HOSPITAL', sub: 'Gastroenterology  |  GI & Colorectal Surgery  |  Medical Oncology', addr: 'Kankanady Main Road, Mangaluru, Karnataka 575 002', contact: 'Tel: 0824-2438 800  |  Email: endoscopy@netravati-hospital.example', reg: 'Reg. No. KA/DK/HOSP/2010/0412', accent: [0.1, 0.35, 0.3], shape: 'square' },
  kudla: { name: 'KUDLA SCAN & IMAGING CENTRE', sub: '3 T MRI  |  128-slice CT  |  Ultrasound', addr: 'Bendoorwell, Mangaluru, Karnataka 575 002', contact: 'Tel: 0824-2210 677  |  Email: mri@kudla-scan.example', reg: 'Reg. No. KA/DK/DC/2017/0118', accent: [0.3, 0.2, 0.5], shape: 'circle' },
  karavali: { name: 'KARAVALI DIAGNOSTIC LABORATORY', sub: 'Biochemistry  |  Haematology  |  Immunoassay', addr: 'Hampankatta, Mangaluru 575 001', contact: 'Tel: 0824-2443 019  |  Email: reports@karavali-lab.example', accent: [0.55, 0.25, 0.1], shape: 'diamond' },
  kadri: { name: 'KADRI HILLS RADIATION ONCOLOGY CENTRE', sub: 'Linear Accelerator  |  3D-CRT  |  IMRT', addr: 'Kadri Temple Road, Mangaluru, Karnataka 575 004', contact: 'Tel: 0824-2215 940  |  Email: rt@kadrihills-rt.example', reg: 'Reg. No. KA/DK/CL/2018/0067', accent: [0.5, 0.1, 0.2], shape: 'square' },
  rispana: { name: 'RISPANA SURGICAL & ENDOCRINE CENTRE', sub: 'Endocrine Surgery  |  Head & Neck Surgery  |  Surgical Oncology', addr: 'Rajpur Road, Dehradun, Uttarakhand 248 001', contact: 'Tel: 0135-2745 300  |  Email: ot@rispana-endocrine.example', reg: 'Reg. No. UK/DDN/HOSP/2015/0094', accent: [0.05, 0.4, 0.45], shape: 'diamond' },
  garhwal: { name: 'GARHWAL HISTOPATHOLOGY & CYTOLOGY CENTRE', addr: '14, Chakrata Road, Dehradun, Uttarakhand 248 001', contact: 'Tel: 0135-2654 118  |  Email: histo@garhwal-path.example', reg: 'Lab Reg. No. UK/DDN/PL/2012/0147', accent: [0.35, 0.2, 0.1], shape: 'circle' },
  himgiri: { name: 'HIMGIRI INSTITUTE OF NUCLEAR MEDICINE', sub: 'Radioiodine Therapy  |  PET-CT  |  Gamma Camera', addr: 'Sahastradhara Road, Dehradun, Uttarakhand 248 013', contact: 'Tel: 0135-2608 270  |  Email: nm@himgiri-nuclear.example', reg: 'AERB Reg. No. UK/NM/2017/0009', accent: [0.4, 0.1, 0.35], shape: 'square' },
  doon: { name: 'दून पैथोलॉजी लैब  |  DOON PATHOLOGY LAB', sub: 'हार्मोन जाँच  |  जैव रसायन  |  Hormone Assays', addr: 'घंटाघर के पास, राजपुर रोड, देहरादून 248 001', contact: 'फ़ोन: 0135-2712 806  |  ईमेल: report@doon-path.example', reg: 'लैब पंजी. सं.: UK/DDN/PL/2019/0218', accent: [0.1, 0.4, 0.25], shape: 'circle' },
  rushikonda: { name: "RUSHIKONDA CHILDREN'S CANCER CENTRE", sub: 'Paediatric Haemato-Oncology  |  Haematopathology  |  Day-Care', addr: 'Beach Road, Rushikonda, Visakhapatnam, Andhra Pradesh 530 045', contact: 'Tel: 0891-2790 455  |  Email: pho@rushikonda-ccc.example', reg: 'Reg. No. AP/VSP/HOSP/2016/0207', accent: [0.55, 0.2, 0.45], shape: 'circle' },
  visakha: { name: 'VISAKHA IMAGING & DIAGNOSTICS', sub: 'Ultrasound  |  CT  |  Digital X-ray', addr: 'Dwaraka Nagar, Visakhapatnam, Andhra Pradesh 530 016', contact: 'Tel: 0891-2565 330  |  Email: usg@visakha-imaging.example', reg: 'Reg. No. AP/VSP/DC/2014/0172', accent: [0.1, 0.3, 0.55], shape: 'diamond' },
  jakhoo: { name: 'JAKHOO HILLS UROLOGY & CANCER CENTRE', sub: 'Urology  |  Uro-oncology  |  Lithotripsy', addr: 'Lakkar Bazar, Shimla, Himachal Pradesh 171 001', contact: 'Tel: 0177-2654 210  |  Email: opd@jakhoohills-uro.example', reg: 'Reg. No. HP/SML/HOSP/2011/0036', accent: [0.2, 0.35, 0.15], shape: 'square' },
  sanjauli: { name: 'SANJAULI NUCLEAR MEDICINE CENTRE', sub: 'Bone Scan  |  SPECT  |  Thyroid Scan', addr: 'Dhalli Road, Sanjauli, Shimla, Himachal Pradesh 171 006', contact: 'Tel: 0177-2840 512  |  Email: scan@sanjauli-nm.example', reg: 'AERB Reg. No. HP/NM/2016/0004', accent: [0.45, 0.3, 0.05], shape: 'circle' },
  himshikha: { name: 'HIMSHIKHA RADIATION ONCOLOGY CENTRE', sub: 'Linear Accelerator  |  3D-CRT  |  Palliative Care', addr: 'Cart Road, Shimla, Himachal Pradesh 171 004', contact: 'Tel: 0177-2803 660  |  Email: radonc@himshikha-rt.example', reg: 'Reg. No. HP/SML/CL/2019/0011', accent: [0.1, 0.25, 0.5], shape: 'diamond' },
  subarnarekha: { name: 'SUBARNAREKHA CANCER HOSPITAL', sub: 'Surgical Oncology  |  Medical Oncology  |  Day-Care Chemotherapy', addr: 'Kanke Road, Ranchi, Jharkhand 834 008', contact: 'Tel: 0651-2230 400  |  Email: mrd@subarnarekha-cancer.example', reg: 'Reg. No. JH/RNC/HOSP/2014/0129', accent: [0.5, 0.25, 0.05], shape: 'square' },
  chotanagpur: { name: 'CHOTANAGPUR PATHOLOGY & MOLECULAR LAB', sub: 'Histopathology  |  Immunohistochemistry  |  Tumour Markers', addr: 'Main Road, Lalpur, Ranchi, Jharkhand 834 001', contact: 'Tel: 0651-2562 931  |  Email: reports@chotanagpur-path.example', reg: 'Lab Reg. No. JH/RNC/PL/2017/0083', accent: [0.2, 0.3, 0.45], shape: 'circle' },
} satisfies Record<string, Inst>

// signatories (invented)
const kamat: Sig = { name: 'Dr. Sameer Kamat', qual: 'M.D., D.M. (Medical Oncology)', reg: 'Reg. No. GMC-4471', role: 'Consultant Thoracic & Medical Oncologist' }
const rodrigues: Sig = { name: 'Dr. Clinton Rodrigues', qual: 'M.D. (Nuclear Medicine)', reg: 'Reg. No. GMC-3916', role: 'Consultant Nuclear Physician' }
const shaikh: Sig = { name: 'Dr. Fatima Shaikh', qual: 'M.D. (Pathology)', reg: 'Reg. No. GMC-4208', role: 'Consultant Histopathologist' }
const pai: Sig = { name: 'Dr. Ashwin Pai', qual: 'M.D., D.M. (Gastroenterology)', reg: 'Reg. No. KMC-71820', role: 'Consultant Gastroenterologist' }
const rai: Sig = { name: 'Dr. Shilpa Rai', qual: 'M.D. (Radiodiagnosis)', reg: 'Reg. No. KMC-80315', role: 'Consultant Radiologist' }
const kamath: Sig = { name: 'Dr. Vidya Kamath', qual: 'M.D. (Radiotherapy)', reg: 'Reg. No. KMC-69842', role: 'Consultant Radiation Oncologist' }
const uniyal: Sig = { name: 'Dr. Manish Uniyal', qual: 'M.S., M.Ch. (Endocrine Surgery)', reg: 'Reg. No. UKMC-2287', role: 'Consultant Endocrine Surgeon' }
const bisht: Sig = { name: 'Dr. Ritu Bisht', qual: 'M.D. (Pathology)', reg: 'Reg. No. UKMC-3051', role: 'Consultant Pathologist' }
const dobhal: Sig = { name: 'Dr. Pallavi Dobhal', qual: 'M.D. (Nuclear Medicine)', reg: 'Reg. No. UKMC-3412', role: 'Consultant Nuclear Medicine Physician' }
const kolluri: Sig = { name: 'Dr. Haritha Kolluri', qual: 'M.D. (Paediatrics), D.M. (Paediatric Haemato-Oncology)', reg: 'Reg. No. APMC-71264', role: 'Consultant Paediatric Haemato-Oncologist' }
const dantuluri: Sig = { name: 'Dr. Srikanth Varma Dantuluri', qual: 'M.D. (Pathology)', reg: 'Reg. No. APMC-66310', role: 'Consultant Haematopathologist' }
const prasanna: Sig = { name: 'Dr. M. Lakshmi Prasanna', qual: 'M.D. (Radiodiagnosis)', reg: 'Reg. No. APMC-74102', role: 'Consultant Radiologist' }
const negi: Sig = { name: 'Dr. Rajinder Singh Negi', qual: 'M.S., M.Ch. (Urology)', reg: 'Reg. No. HPMC-1849', role: 'Consultant Urologist & Uro-oncologist' }
const sood: Sig = { name: 'Dr. Ankita Sood', qual: 'M.D. (Nuclear Medicine)', reg: 'Reg. No. HPMC-3127', role: 'Consultant Nuclear Physician' }
const kanwar: Sig = { name: 'Dr. Vikrant Kanwar', qual: 'M.D. (Radiotherapy)', reg: 'Reg. No. HPMC-2768', role: 'Consultant Radiation Oncologist' }
const tirkey: Sig = { name: 'Dr. Prashant Tirkey', qual: 'M.S., M.Ch. (Surgical Oncology)', reg: 'Reg. No. JMC-2214', role: 'Consultant Surgical Oncologist' }
const ekka: Sig = { name: 'Dr. Anupama Ekka', qual: 'M.D. (Pathology)', reg: 'Reg. No. JMC-3087', role: 'Consultant Pathologist' }
const hembrom: Sig = { name: 'Dr. Sweta Hembrom', qual: 'M.D., D.M. (Medical Oncology)', reg: 'Reg. No. JMC-3350', role: 'Consultant Medical Oncologist' }

const rx = (...names: string[]) => names.map((match) => ({ type: 'prescription_documented', match }))

// ================================================================= the 24 documents
export const heldDocs: HeldDoc[] = [
  // ---------------------------------------------------------------- rosalind (Lung, ALK+, Goa) ---------------------
  {
    patientKey: 'rosalind', n: 1, slug: 'pet-ct-staging', fmt: 'pdf', docType: 'imaging_report',
    title: 'F-18 FDG PET-CT whole body (3rd March 2026)', date: '2026-03-03', inst: J.aguada, footNote: 'Computer-generated report. Valid with signature.',
    tests: 'PET-CT: ordinal study date, dated CECT and dated biopsy HPE inside the clinical history, "MRI brain is suggested" (advice, not a fact), Impression without a TNM stage',
    gold: {
      identity: 'match',
      events: [
        { type: 'imaging_report_documented', date: '2026-03-03', match: 'PET' },
        { type: 'imaging_report_documented', date: '2026-02-18', match: 'CECT' },
        { type: 'pathology_report_documented', date: '2026-02-26' },
        { type: 'impression_documented', match: 'FDG-avid left upper lobe mass' },
      ],
    },
    blocks: [
      HEAD,
      title('F-18 FDG PET-CT SCAN (WHOLE BODY)'),
      grid(
        ['Patient', '*MRS. ROSALIND M. FERNANDES', 'PET ID', '*AINM/PET/26/0388'],
        ['Age / Sex', '48 Y / F', 'Study date', '*3rd March 2026'],
        ['Referred by', 'Dr. Anselm Pereira (Pulmonology)', 'Tracer', 'F-18 FDG 7.8 mCi; fasting BSL 96 mg/dL'],
      ),
      kv('Clinical history:', 'Non-smoker. Cough and left-sided chest pain x 2 months. CECT thorax (18/02/2026): left upper lobe mass. CT-guided biopsy HPE (report dated 26/02/2026): adenocarcinoma. Referred for staging.'),
      h('Technique'),
      p('Images acquired from the vertex to mid-thigh 60 minutes after intravenous FDG, with low-dose non-contrast CT for attenuation correction and anatomical localisation.'),
      h('Findings'),
      ul(
        'Thorax: FDG-avid spiculated mass 4.6 x 3.9 cm in the apico-posterior segment of the left upper lobe (SUVmax 11.8). FDG-avid left hilar (SUVmax 7.2), subaortic and para-aortic (station 5 and 6) nodes, largest 1.8 cm. Small left pleural effusion with a 9 mm avid pleural nodule (SUVmax 4.1).',
        'Skeleton: FDG-avid lytic lesions in the D9 vertebral body (SUVmax 8.4), the right iliac bone and the left 6th rib.',
        'Liver, adrenals, spleen and abdominal nodes: no abnormal FDG uptake.',
        'Brain: physiological cortical uptake limits evaluation; MRI brain with contrast is suggested.',
      ),
      h('Impression'),
      p('FDG-avid left upper lobe mass with left hilar and mediastinal (station 5 and 6) nodal disease, a left pleural deposit with effusion and skeletal metastases (D9, right ilium, left 6th rib), consistent with a metastatic primary lung malignancy.', { bold: true }),
      sig(rodrigues),
      END(),
    ],
  },
  {
    patientKey: 'rosalind', n: 2, slug: 'ihc-lung-alk-pdl1', fmt: 'pdf', docType: 'ihc_molecular_report',
    title: 'Immunohistochemistry - lung panel with ALK and PD-L1 (12-Mar-2026)', date: '2026-03-12', inst: J.zuari, footNote: 'Computer-generated report. Valid with signature.',
    tests: 'IHC report: dd-Mon-yyyy, six marker rows with clones in brackets (ALK D5F3 positive, PD-L1 as a TPS), dated earlier HPE in the header, EGFR PCR sent out and awaited',
    gold: {
      identity: 'match',
      events: [
        { type: 'molecular_test_documented', date: '2026-03-12' },
        { type: 'pathology_report_documented', date: '2026-02-26' },
        { type: 'marker_results_documented', match: 'TTF-1' },
        { type: 'marker_results_documented', match: 'Napsin A' },
        { type: 'marker_results_documented', match: 'p40' },
        { type: 'marker_results_documented', match: 'ALK' },
        { type: 'marker_results_documented', match: 'ROS1' },
        { type: 'marker_results_documented', match: 'PD-L1' },
        { type: 'report_pending_documented', match: 'EGFR' },
      ],
    },
    blocks: [
      HEAD,
      title('IMMUNOHISTOCHEMISTRY REPORT', 'Lung tumour panel with predictive markers'),
      grid(
        ['Name', '*ROSALIND FERNANDES', 'IHC No.', '*ZMH/IHC/26/0147'],
        ['Age / Sex', '48 / F', 'Reported on', '*12-Mar-2026'],
        ['Referred by', 'Dr. Sameer Kamat, Mandovi Cancer Institute', 'Block', 'ZMH/H/26/0592-A'],
      ),
      kv('Specimen:', 'CT-guided core biopsy, left upper lobe lung mass (4 cores).'),
      kv('Previous report:', 'ZMH/H/26/0592 dated 26-Feb-2026 - adenocarcinoma, acinar and solid patterns.'),
      table(['Antibody (clone)', 'Result', 'Remarks'], [0.32, 0.2, 0.48], [
        ['TTF-1 (8G7G3/1)', '*Positive', 'Strong diffuse nuclear staining'],
        ['Napsin A (IP64)', 'Positive', 'Granular cytoplasmic staining'],
        ['p40 (BC28)', 'Negative', '-'],
        ['ALK (D5F3, Ventana)', '*POSITIVE', 'Strong granular cytoplasmic staining in all tumour cells'],
        ['ROS1 (SP384)', 'Negative', '-'],
        ['PD-L1 (22C3)', 'TPS 30 %', 'Adequate sample (more than 100 viable tumour cells)'],
      ]),
      p('Interpretation: adenocarcinoma of lung origin, ALK-rearranged by immunohistochemistry (D5F3 with the OptiView amplification kit; on-slide positive control appropriate).', { italic: true }),
      p('EGFR mutation analysis (real-time PCR, exons 18 - 21) on the same block has been sent to the referral laboratory; the report is awaited.', { bold: true }),
      sig(shaikh),
      END(),
    ],
  },
  {
    patientKey: 'rosalind', n: 3, slug: 'oncology-letter-to-pulmonologist', fmt: 'pdf', docType: 'consult_note',
    title: 'Medical oncology consultation letter (16th March 2026)', date: '2026-03-16', inst: J.mandovi, footNote: 'Consultation letter. Valid with signature.',
    tests: 'consultation as a LETTER in prose: five earlier reports with their own dates inside paragraphs, stage in an "Assessment" line (not an Impression heading), drug named only in a plan (not a prescription), hysterectomy "some years ago" (no date), review date (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'consultation_documented', date: '2026-03-16', match: 'Kamat' },
        { type: 'imaging_report_documented', date: '2026-02-18', match: 'CECT' },
        { type: 'pathology_report_documented', date: '2026-02-26' },
        { type: 'imaging_report_documented', date: '2026-03-03', match: 'PET' },
        { type: 'molecular_test_documented', date: '2026-03-12', match: 'Immunohistochemistry' },
        { type: 'molecular_test_documented', date: '2026-03-15', match: 'EGFR' },
        { type: 'imaging_report_documented', date: '2026-03-14', match: 'MRI' },
        { type: 'stage_documented', match: 'cT2b N2 M1c' },
      ],
    },
    blocks: [
      HEAD,
      p('Ref.: MCI/MO/26/1182          Date: 16th March 2026'),
      p('To,\nDr. Anselm Pereira, M.D. (Pulmonary Medicine)\nPereira Chest Clinic, Station Road, Margao, Goa'),
      p('Re: Mrs. Rosalind Maria Fernandes, 48 years, female (MCI Reg. No. MCI/26/02417)', { bold: true }),
      p('Dear Dr. Pereira,'),
      p('Thank you for referring Mrs. Fernandes, whom I saw today in the thoracic oncology clinic with her husband. She is a lifelong non-smoker and a school librarian, with a dry cough and left-sided chest pain for about two months. She had a hysterectomy for fibroids some years ago and has no other illnesses. She is ECOG 1, with decreased air entry at the left base and tenderness over the lower dorsal spine.'),
      p('Her CECT thorax of 18/02/2026 showed a left upper lobe mass, and the CT-guided biopsy (HPE dated 26/02/2026) confirmed adenocarcinoma. The PET-CT done on 03/03/2026 shows left hilar and mediastinal nodes, a left pleural deposit and bone metastases (D9, right ilium, left 6th rib). Immunohistochemistry (12/03/2026) is ALK positive (D5F3) with PD-L1 TPS 30 %, and EGFR by RT-PCR is negative (report of 15/03/2026). A contrast MRI of the brain on 14/03/2026 showed a single 7 mm enhancing lesion in the right frontal lobe without oedema.'),
      kv('Assessment:', 'Adenocarcinoma of the left lung, ALK-rearranged, stage IVB (cT2b N2 M1c, AJCC 8th edition), with bone, pleural and a single small brain metastasis.'),
      h('Plan'),
      ul(
        'We plan to start alectinib as soon as the drug is available through the patient-assistance programme. Because of its good intracranial activity, the small brain lesion will be watched with an MRI after 8 weeks rather than treated upfront with radiosurgery.',
        'Bone-modifying therapy for the skeletal metastases after a dental check-up, with calcium and vitamin D.',
        'Baseline LFT, CPK, lipid profile and ECG before starting. I shall see her again on 30/03/2026.',
      ),
      p('I shall keep you informed of her progress. Please do not hesitate to call me if you need any further information.'),
      p('With warm regards,'),
      sig(kamat),
    ],
  },
  {
    patientKey: 'rosalind', n: 4, slug: 'prescription-alectinib', fmt: 'pdf', docType: 'prescription_printed',
    title: 'Prescription (30.03.2026)', date: '2026-03-30', inst: J.kamat, institution: 'Dr. Sameer Kamat, Mandovi Cancer Institute', footNote: 'Prescription. Valid with signature.',
    tests: 'printed prescription on a doctor letterhead: oral targeted drug in capsules, a monthly injection, a combination calcium tablet; dated MRI follow-up and review in the advice (future)',
    gold: { identity: 'match', events: rx('Alectinib', 'Denosumab', 'Calcium', 'Paracetamol', 'Lactulose') },
    blocks: [
      HEAD,
      grid(['Patient', '*Mrs. ROSALIND M. FERNANDES', 'Date', '*30.03.2026'], ['Age / Sex', '48 / F', 'Reg. No.', 'MCI/26/02417']),
      p('Dx: Adenocarcinoma lung, ALK positive, with bone, pleural and brain metastases.'),
      h('Rx'),
      table(['#', 'Medicine', 'Dose / timing', 'Duration'], [0.06, 0.4, 0.4, 0.14], [
        ['1', 'Cap. Alectinib 150 mg', '4 caps (600 mg) twice daily with food', '1 month'],
        ['2', 'Inj. Denosumab 120 mg', 'Subcutaneous, once every 4 weeks', 'Continue'],
        ['3', 'Tab. Calcium carbonate 500 mg + Vitamin D3 250 IU', '1 tab twice daily after meals', '1 month'],
        ['4', 'Tab. Paracetamol 650 mg', '1 tab if pain, up to 3 a day', '10 days'],
        ['5', 'Syp. Lactulose 10 g/15 mL', '15 mL at bedtime, if constipated', '10 days'],
      ]),
      h('Advice'),
      ul(
        'LFT and CPK every 2 weeks for the first 3 months.',
        'Report muscle pain, swelling of the feet, yellow eyes or a very slow pulse. Avoid strong sun; use sunscreen.',
        'Review on 27/04/2026 with CBC, LFT and CPK. MRI brain after 8 weeks (around 25/05/2026).',
      ),
      sig(kamat),
    ],
  },

  // ---------------------------------------------------------------- raghavendra (Rectum, Mangaluru) ----------------
  {
    patientKey: 'raghavendra', n: 1, slug: 'colonoscopy-report', fmt: 'pdf', docType: 'procedure_note',
    title: 'Colonoscopy report (07/01/2026)', date: '2026-01-07', inst: J.netravati, footNote: 'Endoscopy suite record. Valid with signature.',
    tests: 'endoscopy report: sedation drugs in the header (not prescriptions), "Endoscopic diagnosis" heading (not an imaging impression), biopsies "sent for HPE", investigations advised (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'procedure_documented', date: '2026-01-07', match: 'Colonoscopy' },
        { type: 'report_pending_documented', match: 'HPE' },
      ],
    },
    blocks: [
      HEAD,
      title('COLONOSCOPY REPORT', 'Department of Medical Gastroenterology - Endoscopy Suite'),
      grid(
        ['Patient', '*RAGHAVENDRA V. SHETTY', 'UHID', '*NGCH/25/88104'],
        ['Age / Sex', '59 Y / Male', 'Date', '*07/01/2026'],
        ['Endoscopist', 'Dr. Ashwin Pai', 'Sedation', 'Inj. Midazolam 2 mg + Inj. Fentanyl 50 mcg IV'],
        ['Indication', 'Bleeding per rectum x 3 months, altered bowel habit, weight loss 6 kg', 'Bowel prep', 'PEG, adequate (Boston score 7)'],
      ),
      h('Procedure'),
      p('Digital rectal examination: hard, irregular growth felt at the fingertip, lower edge about 6 cm from the anal verge. Colonoscope passed up to the caecum; ileocaecal valve and appendicular orifice identified. Withdrawal time 9 minutes.'),
      h('Findings'),
      ul(
        'Rectum: ulceroproliferative, friable, near-circumferential growth from 6 to 11 cm from the anal verge, narrowing the lumen; the scope could be negotiated beyond it with gentle pressure.',
        'Sigmoid colon: a few diverticula; no polyp.',
        'Rest of the colon up to the caecum: normal mucosa; no synchronous lesion.',
      ),
      h('Endoscopic diagnosis'),
      p('Ulceroproliferative growth in the mid and lower rectum, suspicious of carcinoma.', { bold: true }),
      p('Multiple biopsies (6 bits) taken from the growth and sent for HPE. The lower edge of the lesion tattooed with India ink in two quadrants.', { bold: true }),
      p('Advice: serum CEA, MRI pelvis (rectal protocol) and CECT chest and abdomen. Review in Surgical Oncology OPD (Dr. Harish Bhandary) with the HPE report.'),
      sig(pai),
    ],
  },
  {
    patientKey: 'raghavendra', n: 2, slug: 'mri-pelvis-rectal-protocol', fmt: 'pdf', docType: 'imaging_report',
    title: 'MRI pelvis - rectal cancer staging (14-01-2026)', date: '2026-01-14', inst: J.kudla, footNote: 'Reported by a consultant radiologist.',
    tests: 'MRI: dd-mm-yyyy, alias "Mr. R. V. SHETTY", dated colonoscopy in the clinical details with HPE awaited, Impression carrying an mrTN stage, EMVI and MRF terms',
    gold: {
      identity: 'match',
      events: [
        { type: 'imaging_report_documented', date: '2026-01-14', match: 'MRI' },
        { type: 'procedure_documented', date: '2026-01-07', match: 'Colonoscopy' },
        { type: 'report_pending_documented', match: 'HPE' },
        { type: 'impression_documented', match: 'Mid-rectal carcinoma' },
        { type: 'stage_documented', match: 'mrT3c N2a' },
      ],
    },
    blocks: [
      HEAD,
      title('MRI PELVIS - RECTAL CANCER STAGING PROTOCOL'),
      grid(
        ['Patient', '*Mr. R. V. SHETTY', 'MRI No.', '*KSC/MR/26/0091'],
        ['Age / Sex', '59 / M', 'Date', '*14-01-2026'],
        ['Referred by', 'Dr. Harish Bhandary (Surgical Oncology)', 'Scanner', '3 T; small-FOV T2, DWI, post-contrast'],
      ),
      kv('Clinical details:', 'Colonoscopy (07/01/2026): rectal growth 6 - 11 cm from the anal verge, biopsies taken; HPE awaited.'),
      h('Findings'),
      ul(
        'Tumour: semi-annular (about 270 degrees) mid-rectal tumour, lower edge 6.2 cm from the anal verge and 3.1 cm above the anorectal junction; craniocaudal length 5.4 cm.',
        'Depth: extramural spread of 9 mm at the 3 - 5 o\'clock position. Mesorectal fascia (MRF): tumour lies 1 mm from the left lateral MRF.',
        'EMVI: positive (tumour-expanded vein at the 4 o\'clock position).',
        'Nodes: four mesorectal nodes with irregular borders and mixed signal, largest 8 mm. No lateral pelvic sidewall nodes.',
        'Tumour lies below the peritoneal reflection. Bladder, seminal vesicles and prostate free. No pelvic bony lesion.',
      ),
      h('Impression'),
      p('Mid-rectal carcinoma, mrT3c N2a, EMVI positive, MRF threatened (1 mm, left lateral); lower edge 6.2 cm from the anal verge.', { bold: true }),
      sig(rai),
      END(),
    ],
  },
  {
    patientKey: 'raghavendra', n: 3, slug: 'cea-lft-photo-partial-header', fmt: 'jpg', docType: 'lab_report',
    title: 'CEA, LFT and haemoglobin (09-Jan-2026)', date: '2026-01-09', inst: J.karavali, fs: 1.12, footNote: 'Computer-generated report.',
    photo: { angle: -1.5, paper: '#f5f1e8', desk: '#4a4038', dx: -8, dy: 10, seed: 151 },
    tests: 'photographed lab report with a PARTIAL header: surname only ("Mr. SHETTY"), age and sex, no hospital ID; identity cannot be confirmed, must be held; section rows and H / L flags',
    gold: { identity: 'insufficient', held: true, events: [{ type: 'lab_report_documented', date: '2026-01-09', match: 'CEA' }] },
    blocks: [
      HEAD,
      title('TUMOUR MARKER & BIOCHEMISTRY'),
      grid(
        ['Name', '*Mr. SHETTY', 'Lab No.', '*KDL/0109/2231'],
        ['Age / Sex', '59 Y / M', 'Collected', '09-Jan-2026 08:40'],
        ['Ref. by', 'Dr. Harish Bhandary', 'Reported', '*09-Jan-2026 16:05'],
      ),
      table(['Test', 'Result', 'Unit', 'Reference range'], [0.38, 0.2, 0.14, 0.28], [
        ['#TUMOUR MARKER'],
        ['CEA (CLIA)', '*18.6  H', 'ng/mL', 'Non-smoker: below 5.0'],
        ['#LIVER FUNCTION'],
        ['Total bilirubin', '0.7', 'mg/dL', '0.2 - 1.2'],
        ['SGOT (AST)', '28', 'U/L', 'up to 40'],
        ['SGPT (ALT)', '31', 'U/L', 'up to 41'],
        ['Alkaline phosphatase', '96', 'U/L', '40 - 129'],
        ['Serum albumin', '3.9', 'g/dL', '3.5 - 5.2'],
        ['#HAEMATOLOGY'],
        ['Haemoglobin', '*10.4  L', 'g/dL', '13.0 - 17.0'],
      ]),
      p('Sample: serum / EDTA. CEA may be raised in smokers and in benign conditions; interpret with clinical findings.', { size: 8.6 }),
      p('Checked by: Dr. Prema Rao, M.D. (Biochemistry)', { size: 8.6 }),
      END(),
    ],
  },
  {
    patientKey: 'raghavendra', n: 4, slug: 'short-course-rt-summary', fmt: 'pdf', docType: 'radiotherapy_summary',
    title: 'Radiotherapy treatment summary - short-course pelvic RT (9 Feb 2026)', date: '2026-02-09', inst: J.kadri, footNote: 'Computer-generated treatment summary. Valid with signature.',
    tests: 'radiotherapy summary: "9 Feb 2026", stage line citing a dated MRI and a dated CECT, baseline CEA with its date, dated HPE in the diagnosis, loperamide in the toxicity prose (not a prescription), first CAPOX cycle date (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'radiotherapy_documented', match: '25 Gy' },
        { type: 'pathology_report_documented', date: '2026-01-16' },
        { type: 'stage_documented', match: 'cT3c N2a' },
        { type: 'imaging_report_documented', date: '2026-01-14', match: 'MRI' },
        { type: 'imaging_report_documented', date: '2026-01-19', match: 'CECT' },
        { type: 'lab_report_documented', date: '2026-01-09', match: 'CEA' },
      ],
    },
    blocks: [
      HEAD,
      title('RADIOTHERAPY TREATMENT SUMMARY', 'Short-course pre-operative radiotherapy (total neoadjuvant therapy)'),
      grid(
        ['Name', '*Raghavendra Shetty', 'RT Reg. No.', '*KHR/26/0064'],
        ['Age / Sex', '59 Y / M', 'Date', '*9 Feb 2026'],
        ['Referred by', 'Dr. Harish Bhandary, Netravati Gastro & Cancer Hospital', 'Radiation oncologist', 'Dr. Vidya Kamath'],
      ),
      kv('Diagnosis:', 'Adenocarcinoma rectum, moderately differentiated (HPE NGCH/HP/26/0133 dated 16/01/2026); lower edge 6 cm from the anal verge.'),
      kv('Stage:', 'cT3c N2a M0 - MRI pelvis 14/01/2026 (EMVI positive, MRF threatened); CECT chest and abdomen 19/01/2026: no distant metastases.'),
      kv('Baseline CEA:', '18.6 ng/mL (09/01/2026)'),
      h('Treatment delivered'),
      table(['Parameter', 'Details'], [0.3, 0.7], [
        ['Technique', '3D-CRT, three fields (posterior and two laterals), 15 MV photons, prone on a belly board'],
        ['Target volume', 'Primary tumour, mesorectum, presacral and internal iliac nodal regions'],
        ['Dose', '25 Gy in 5 fractions, 5 Gy per fraction, daily'],
        ['Dates', '02/02/2026 to 06/02/2026'],
        ['Concurrent chemotherapy', 'None (short-course)'],
        ['Interruptions', 'Nil'],
      ]),
      h('Acute toxicity'),
      p('Grade 1 diarrhoea and Grade 1 proctitis on days 4 - 5, settled with loperamide and sitz baths. No urinary toxicity. Weight stable at 64 kg.'),
      h('Plan'),
      ul(
        'Consolidation chemotherapy with CAPOX x 6 cycles in Medical Oncology; first cycle on 17/02/2026.',
        'Restaging MRI pelvis and CECT after chemotherapy, followed by surgical oncology review for total mesorectal excision.',
      ),
      sig(kamath),
    ],
  },

  // ---------------------------------------------------------------- nandita (Thyroid, Dehradun) ---------------------
  {
    patientKey: 'nandita', n: 1, slug: 'total-thyroidectomy-operation-note', fmt: 'pdf', docType: 'procedure_note',
    title: 'Operation notes - total thyroidectomy (3rd March 2026)', date: '2026-03-03', inst: J.rispana, footNote: 'Operation theatre record. Valid with signature.',
    tests: 'operation note as key-value lines: ordinal date, dated FNAC (Bethesda VI) in the pre-operative diagnosis, nerve monitoring and parathyroid autotransplantation steps as bullets, specimens "sent for HPE"',
    gold: {
      identity: 'match',
      events: [
        { type: 'procedure_documented', date: '2026-03-03', match: 'thyroidectomy' },
        { type: 'pathology_report_documented', date: '2026-02-14', match: 'FNAC' },
        { type: 'report_pending_documented', match: 'HPE' },
      ],
    },
    blocks: [
      HEAD,
      title('OPERATION NOTES'),
      kv('Patient:', 'Ms. Nandita Rawat      Age / Sex: 34 / F      IP No.: RSE/IP/26/0418'),
      kv('Date of surgery:', '3rd March 2026'),
      kv('Surgeon:', 'Dr. Manish Uniyal (Endocrine Surgery)      Assistant: Dr. Kritika Bhatt'),
      kv('Anaesthetist:', 'Dr. Rohit Semwal - GA with a nerve-monitoring (NIM) endotracheal tube'),
      kv('Pre-operative diagnosis:', 'Papillary carcinoma thyroid (FNAC dated 14/02/2026: Bethesda VI); right lobe nodule 2.8 cm with suspicious central (level VI) nodes on USG.'),
      kv('Operation:', 'Total thyroidectomy with bilateral central compartment (level VI) neck dissection'),
      h('Findings'),
      p('Right lobe: firm nodule 3 x 2.5 cm in the mid and lower pole, adherent to the sternothyroid, which was shaved off the capsule. Left lobe normal to palpation. Enlarged firm right paratracheal and prelaryngeal nodes, largest 1.2 cm. Both recurrent laryngeal nerves identified and preserved, with intact signals at the end of the procedure.'),
      h('Steps'),
      ul(
        'Kocher collar incision two finger-breadths above the sternal notch; subplatysmal flaps raised.',
        'Superior pole vessels ligated close to the gland; both superior parathyroids preserved in situ.',
        'Right inferior parathyroid devascularised: minced and autotransplanted into the right sternocleidomastoid.',
        'Bilateral level VI clearance from the hyoid to the innominate artery.',
        'Haemostasis secured; no drain; skin closed with a subcuticular absorbable suture.',
      ),
      p('Specimens (thyroid with a stitch on the right superior pole; right and left level VI nodes in separate containers) sent for HPE.', { bold: true }),
      p('Post-op orders: serum calcium and PTH at 6 hours and next morning; watch for tingling, stridor or voice change.'),
      sig(uniyal),
    ],
  },
  {
    patientKey: 'nandita', n: 2, slug: 'thyroid-histopathology', fmt: 'pdf', docType: 'pathology_report',
    title: 'Surgical pathology - total thyroidectomy (11-03-2026)', date: '2026-03-11', inst: J.garhwal, footNote: 'Computer-generated report. Valid with signature.',
    tests: 'pathology: received vs reported dates, operation date inside the specimen cell, synoptic table with a "Margin status" row worded "Uninvolved", microscopic ETE, pTNM row',
    gold: {
      identity: 'match',
      events: [
        { type: 'pathology_report_documented', date: '2026-03-11' },
        { type: 'procedure_documented', date: '2026-03-03', match: 'thyroidectomy' },
        { type: 'margins_documented', match: 'Uninvolved by carcinoma' },
        { type: 'stage_documented', match: 'pT2 pN1a' },
      ],
    },
    blocks: [
      HEAD,
      title('SURGICAL PATHOLOGY REPORT'),
      grid(
        ['Patient Name', '*Ms. NANDITA RAWAT', 'Accession No.', '*GHC/S/26/1027'],
        ['Age / Sex', '34 Yrs / F', 'Received', '04-03-2026'],
        ['Clinician', 'Dr. Manish Uniyal, Rispana Surgical & Endocrine Centre', 'Reported', '*11-03-2026'],
        ['Specimen', 'Total thyroidectomy with bilateral level VI nodes (operated 03-03-2026)', 'Previous', 'FNAC GHC/C/26/0211'],
      ),
      h('Gross'),
      p('Total thyroidectomy specimen weighing 24 g; right lobe 5 x 3 x 2.5 cm, left lobe 4.5 x 2 x 1.8 cm, isthmus 1.5 cm. A grey-white firm unencapsulated nodule 2.6 x 2.2 x 2 cm in the right lobe with gritty cut surface, reaching close to the posterior capsule. Left lobe unremarkable. Right level VI: 6 nodes; left level VI: 5 nodes.'),
      h('Microscopy'),
      p('Papillary thyroid carcinoma, classic type: complex branching papillae lined by cells with overlapping, optically clear nuclei, nuclear grooves and pseudo-inclusions; psammoma bodies present. Focal extension into perithyroidal fat (microscopic). Background lymphocytic thyroiditis.'),
      h('Synoptic summary'),
      table(['Parameter', 'Finding'], [0.32, 0.68], [
        ['Histological type', 'Papillary thyroid carcinoma, classic (conventional) type'],
        ['Focality / size', 'Unifocal; 2.6 cm, right lobe'],
        ['Extrathyroidal extension', 'Microscopic only (perithyroidal soft tissue); no gross extension'],
        ['Lymphovascular invasion', 'Present, focal (fewer than 4 vessels)'],
        ['Margin status', 'Uninvolved by carcinoma; closest 0.8 mm (posterior capsule, right lobe)'],
        ['Lymph nodes', 'Right level VI: 4/6 involved (largest deposit 0.9 cm, no extranodal extension); left level VI: 0/5'],
        ['Parathyroid', 'One parathyroid gland in the specimen (incidental)'],
        ['pTNM (AJCC 8th ed.)', '*pT2 pN1a'],
      ]),
      h('Diagnosis'),
      p('Total thyroidectomy: PAPILLARY THYROID CARCINOMA, classic type, 2.6 cm, right lobe; metastatic carcinoma in 4 of 11 central compartment lymph nodes.', { bold: true }),
      sig(bisht),
      END(),
    ],
  },
  {
    patientKey: 'nandita', n: 3, slug: 'radioiodine-discharge-summary', fmt: 'pdf', docType: 'discharge_summary',
    title: 'Discharge summary - radioiodine therapy (20/04/2026 to 23/04/2026)', date: '2026-04-23', inst: J.himgiri, cont: 'Nandita Rawat  |  IP No. HINM/IP/26/0071  |  Discharge summary (contd.)', footNote: 'Discharge summary. Valid with signature.',
    tests: 'two-page nuclear-medicine discharge: I-131 therapy with its own date, dated pre-therapy labs, post-therapy whole-body scan with its own date, pathological stage and surgery date restated in the diagnosis, medication table with levothyroxine, radiation-safety advice and review dates (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'admission_documented', date: '2026-04-20' },
        { type: 'discharge_documented', date: '2026-04-23' },
        { type: 'radiotherapy_documented', match: 'I-131' },
        { type: 'imaging_report_documented', date: '2026-04-22', match: 'Whole-body' },
        { type: 'lab_report_documented', date: '2026-04-17', match: 'TSH' },
        { type: 'stage_documented', match: 'pT2 pN1a' },
        { type: 'procedure_documented', date: '2026-03-03', match: 'thyroidectomy' },
        ...rx('Levothyroxine', 'Calcium', 'Calcitriol', 'Ondansetron', 'Pantoprazole'),
      ],
    },
    blocks: [
      HEAD,
      title('DISCHARGE SUMMARY', 'Radioiodine therapy ward (isolation)'),
      grid(
        ['Name', '*Ms. NANDITA RAWAT', 'IP No.', '*HINM/IP/26/0071'],
        ['Age / Sex', '34 / F', 'Consultant', 'Dr. Pallavi Dobhal (Nuclear Medicine)'],
        ['Admitted', '20/04/2026', 'Discharged', '23/04/2026'],
      ),
      h('Diagnosis'),
      p('Papillary carcinoma thyroid, pT2 pN1a (AJCC 8th), ATA intermediate risk; status post total thyroidectomy with bilateral central compartment dissection (03/03/2026).'),
      h('Pre-therapy work-up'),
      p('Levothyroxine withdrawn for 4 weeks; low-iodine diet for 2 weeks. Blood tests on 17/04/2026: TSH 68.4 mIU/L, stimulated thyroglobulin 4.6 ng/mL, anti-thyroglobulin antibodies negative. Urine pregnancy test before therapy: negative.'),
      h('Treatment'),
      p('Oral radioiodine (I-131) 100 mCi administered on 20/04/2026 for adjuvant ablation. Kept in the shielded isolation room for 72 hours; dose rate at 1 metre at discharge 18 microSv/h.', { bold: true }),
      h('Post-therapy scan'),
      p('Whole-body I-131 scan on 22/04/2026: uptake in the thyroid bed (remnant) and a small focus in the right paratracheal region (nodal); no uptake in the lungs or skeleton.'),
      h('Course'),
      p('Mild neck discomfort and nausea on day 1, settled with ondansetron. No sialadenitis. Calcium normal on oral supplements.'),
      { t: 'br' },
      h('Medications on discharge'),
      table(['Medicine', 'Dose', 'When', 'Duration'], [0.4, 0.12, 0.28, 0.2], [
        ['Tab. Levothyroxine 100 mcg', '1 tab', 'Empty stomach, 6 am', 'Long term (start 23/04/2026)'],
        ['Tab. Calcium carbonate 1250 mg', '1 tab', 'Twice daily after meals', '1 month'],
        ['Cap. Calcitriol 0.25 mcg', '1 cap', 'Once daily', '1 month'],
        ['Tab. Ondansetron 4 mg', '1 tab', 'If nausea', '3 days'],
        ['Tab. Pantoprazole 40 mg', '1 tab', 'Before breakfast', '7 days'],
      ]),
      h('Advice'),
      ul(
        'Drink plenty of water; suck lemon drops or chew sugar-free gum for 3 days to protect the salivary glands.',
        'For 7 days: sleep alone, keep 1 metre from adults and 2 metres from children and pregnant women; use a separate toilet and flush twice.',
        'Avoid pregnancy for 6 months after radioiodine.',
        'TSH and free T4 after 6 weeks; diagnostic whole-body scan with stimulated thyroglobulin after 6 months. Review in Nuclear Medicine OPD on 04/06/2026.',
      ),
      sig(dobhal),
    ],
  },
  {
    patientKey: 'nandita', n: 4, slug: 'thyroid-profile-bilingual-photo', fmt: 'jpg', docType: 'lab_report',
    title: 'Thyroid profile with thyroglobulin, bilingual (17/04/2026)', date: '2026-04-17', inst: J.doon, institution: 'Doon Pathology Lab', fs: 1.12, footNote: 'कंप्यूटर जनित रिपोर्ट  |  Computer-generated report.',
    photo: { angle: 1.3, paper: '#f3eee2', desk: '#3d4852', dx: 10, dy: -6, seed: 157 },
    tests: 'photographed bilingual (Hindi + English) lab report: Devanagari letterhead and labels, collected and reported times on the same day, H / L flags',
    gold: { identity: 'match', events: [{ type: 'lab_report_documented', date: '2026-04-17' }] },
    blocks: [
      HEAD,
      title('THYROID PROFILE  |  थायरॉइड प्रोफ़ाइल'),
      grid(
        ['नाम / Name', '*NANDITA RAWAT', 'लैब सं. / Lab No.', '*DPL/2604/1733'],
        ['आयु / लिंग', '34 वर्ष / महिला', 'नमूना / Collected', '17/04/2026 08:20'],
        ['Ref. Dr.', 'Dr. Pallavi Dobhal', 'रिपोर्ट / Reported', '*17/04/2026 18:45'],
      ),
      table(['जाँच / Test', 'परिणाम / Result', 'इकाई / Unit', 'संदर्भ सीमा / Ref. range'], [0.36, 0.2, 0.16, 0.28], [
        ['TSH (ultrasensitive)', '*68.4  H', 'mIU/L', '0.35 - 4.94'],
        ['Free T4', '*0.31  L', 'ng/dL', '0.70 - 1.48'],
        ['Thyroglobulin (Tg)', '4.6', 'ng/mL', 'see note'],
        ['Anti-thyroglobulin antibody', '12.0', 'IU/mL', 'below 115 (negative)'],
      ]),
      p('टिप्पणी / Note: थायरॉक्सिन बंद करने के बाद (TSH stimulated) थायरोग्लोबुलिन। Interpret Tg together with the anti-Tg antibody status.', { size: 9.5 }),
      p('जाँचकर्ता / Checked by: Dr. Sunita Kandari, M.D. (Pathology)', { size: 8.8 }),
      END('*** रिपोर्ट समाप्त / End of Report ***'),
    ],
  },

  // ---------------------------------------------------------------- saiteja (Paediatric B-ALL, Visakhapatnam) -------
  {
    patientKey: 'saiteja', n: 1, slug: 'bone-marrow-flow-report', fmt: 'pdf', docType: 'pathology_report',
    title: 'Bone marrow examination with flow cytometry (08/06/2026)', date: '2026-06-08', inst: J.rushikonda, footNote: 'Computer-generated report. Valid with signature.',
    tests: 'bone-marrow report for a child: "Master" prefix, father\'s name in the header, procedure date separate from report date, dated CBC in the clinical details, flow cytometry in prose, FISH and karyotype sent (pending)',
    gold: {
      identity: 'match',
      events: [
        { type: 'pathology_report_documented', date: '2026-06-08' },
        { type: 'procedure_documented', date: '2026-06-06', match: 'trephine' },
        { type: 'lab_report_documented', date: '2026-06-04', match: 'CBC' },
        { type: 'report_pending_documented', match: 'FISH' },
      ],
    },
    blocks: [
      HEAD,
      title('BONE MARROW EXAMINATION REPORT', 'Haematopathology - aspirate, trephine biopsy and flow cytometry'),
      grid(
        ['Patient', '*Master P. V. SAI TEJA', 'BM No.', '*RCCC/BM/26/0219'],
        ['Age / Sex', '8 Y 4 M / Male', 'UHID', 'RCCC/26/04471'],
        ['Father', 'Mr. P. Srinivasa Rao', 'Report date', '*08/06/2026'],
        ['Procedure', 'Bone marrow aspiration and trephine biopsy on 06/06/2026 (under sedation)'],
        ['Clinician', 'Dr. Haritha Kolluri (Paediatric Haemato-Oncology)'],
      ),
      kv('Clinical details:', 'Fever and pallor x 3 weeks, bone pains, petechiae; hepatosplenomegaly. CBC (04/06/2026): Hb 6.8 g/dL, TLC 48,600 /cumm with 62 % blasts, platelets 22,000 /cumm.'),
      h('Aspirate (posterior superior iliac spine)'),
      p('Particulate, hypercellular smears. Blasts form 86 % of all nucleated cells: small to intermediate size, high N:C ratio, fine chromatin, inconspicuous nucleoli and scant agranular cytoplasm. Erythroid and myeloid precursors and megakaryocytes markedly suppressed. MPO cytochemistry: blasts negative.'),
      h('Trephine biopsy'),
      p('Core 1.4 cm; 95 % cellular, diffusely replaced by sheets of blasts. Reticulin grade 1.'),
      h('Flow cytometry (aspirate, 10-colour)'),
      p('Blasts (CD45 dim, low side scatter) express CD19, CD10, CD34, TdT, cytoplasmic CD79a and HLA-DR; they are negative for cytoplasmic CD3, MPO, CD13, CD33 and CD20. Immunophenotype: precursor B-cell (common B) ALL.'),
      h('Diagnosis'),
      p('B-LYMPHOBLASTIC LEUKAEMIA (B-ALL), common B (CD10 positive) immunophenotype; marrow blasts 86 %.', { bold: true }),
      p('Karyotype and FISH for BCR::ABL1, ETV6::RUNX1, KMT2A and TCF3::PBX1 have been sent on the heparinised sample; the report will follow.', { italic: true }),
      sig(dantuluri),
      END(),
    ],
  },
  {
    patientKey: 'saiteja', n: 2, slug: 'induction-discharge-summary', fmt: 'pdf', docType: 'discharge_summary',
    title: 'Discharge summary - induction chemotherapy (05/06/2026 to 19/06/2026)', date: '2026-06-19', inst: J.rushikonda, cont: 'Master P. V. Sai Teja  |  UHID RCCC/26/04471  |  Discharge summary (contd.)', footNote: 'Discharge summary. Valid with signature.',
    tests: 'paediatric two-page discharge: guardian in the header, dated marrow procedure and report, dated FISH result, karyotype awaited, PICC insertion with its date, dated in-patient chemotherapy table (doses, not prescriptions), drugs in the course prose (not prescriptions), Day 15 date (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'admission_documented', date: '2026-06-05' },
        { type: 'discharge_documented', date: '2026-06-19' },
        { type: 'procedure_documented', date: '2026-06-06', match: 'trephine' },
        { type: 'pathology_report_documented', date: '2026-06-08' },
        { type: 'molecular_test_documented', date: '2026-06-12', match: 'FISH' },
        { type: 'report_pending_documented', match: 'Karyotype' },
        { type: 'procedure_documented', date: '2026-06-07', match: 'PICC' },
        { type: 'chemotherapy_session_documented', date: '2026-06-08', match: 'Day 1' },
        { type: 'chemotherapy_session_documented', date: '2026-06-11', match: 'Day 4' },
        { type: 'chemotherapy_session_documented', date: '2026-06-15', match: 'Day 8' },
        ...rx('Prednisolone', 'Cotrimoxazole', 'Fluconazole', 'Pantoprazole', 'Lactulose'),
      ],
    },
    blocks: [
      HEAD,
      title('DISCHARGE SUMMARY', 'Paediatric Haemato-Oncology Ward'),
      grid(
        ['Name', '*Master POTHULA VENKATA SAI TEJA', 'UHID', '*RCCC/26/04471'],
        ['Age / Sex', '8 years / Male', 'IP No.', 'RCCC/IP/26/1365'],
        ['Date of admission', '05/06/2026', 'Date of discharge', '19/06/2026'],
        ['Consultant', 'Dr. Haritha Kolluri', 'Guardian', 'Mr. P. Srinivasa Rao (father)'],
      ),
      h('Diagnosis'),
      p('Precursor B-cell acute lymphoblastic leukaemia (common B), NCI standard risk; CNS 1; ETV6::RUNX1 positive.'),
      h('Investigations'),
      ul(
        'Bone marrow aspiration and trephine biopsy on 06/06/2026 (reported 08/06/2026): 86 % blasts; flow cytometry - B-ALL, CD10 positive.',
        'FISH report dated 12/06/2026: ETV6::RUNX1 fusion detected; BCR::ABL1, KMT2A and TCF3::PBX1 not detected. Karyotype awaited.',
        '2D echo before daunorubicin: LVEF 66 %, structurally normal heart.',
        'Tumour lysis monitoring: uric acid peaked at 7.9 mg/dL on Day 2; potassium, phosphate and creatinine normal throughout.',
      ),
      h('Course in the ward'),
      p('Admitted with fever, pallor and bone pains. Received 2 units of irradiated, leucodepleted PRBC and one apheresis platelet unit. Hyperhydration and allopurinol given for tumour lysis prophylaxis. Right-arm PICC line inserted under sedation on 07/06/2026. Febrile neutropenia on Day 6 was treated with Inj. Piperacillin-tazobactam for 7 days; blood culture sterile. Induction chemotherapy as per the ICiCLe-ALL-14 protocol (standard-risk arm) has been well tolerated apart from constipation and jaw pain after vincristine.'),
      { t: 'br' },
      h('Chemotherapy given during this admission'),
      table(['Day / date', 'Drugs and doses (BSA 0.91 m2)'], [0.26, 0.74], [
        ['Day 1 (08/06/2026)', 'Inj. Vincristine 1.4 mg IV, Inj. Daunorubicin 23 mg IV, IT methotrexate 10 mg; Tab. Prednisolone 60 mg/m2/day started'],
        ['Day 4 (11/06/2026)', 'Inj. PEG-asparaginase 2,050 IU (2,250 IU/m2) IM'],
        ['Day 8 (15/06/2026)', 'Inj. Vincristine 1.4 mg IV, Inj. Daunorubicin 23 mg IV, IT methotrexate 10 mg'],
      ]),
      h('Medications on discharge'),
      table(['Medicine', 'Dose', 'When', 'Duration'], [0.36, 0.18, 0.26, 0.2], [
        ['Tab. Prednisolone 10 mg', '2.5 tabs (25 mg)', 'Twice daily after food', 'Till Day 28, then taper'],
        ['Tab. Cotrimoxazole 480 mg', '1 tab', 'Twice daily on Sat, Sun, Mon', 'Continue'],
        ['Syp. Fluconazole 50 mg/5 mL', '5 mL', 'Once daily', 'Till end of induction'],
        ['Tab. Pantoprazole 20 mg', '1 tab', 'Before breakfast', 'While on steroids'],
        ['Syp. Lactulose 10 g/15 mL', '10 mL', 'At bedtime', '7 days'],
      ]),
      h('Advice'),
      ul(
        'Day 15 chemotherapy in Day-Care on 22/06/2026, with CBC and LFT the previous day.',
        'Bring the child immediately for fever of 100.4 F or more, bleeding, unusual drowsiness or pain abdomen.',
        'Hand hygiene, boiled water and home-cooked food; avoid crowds and sick contacts. No live vaccines.',
        'Mouth care with a soft brush and saline gargles after every meal; PICC dressing weekly in Day-Care.',
      ),
      sig(kolluri),
    ],
  },
  {
    patientKey: 'saiteja', n: 3, slug: 'daycare-induction-day15', fmt: 'pdf', docType: 'chemo_daycare_record',
    title: 'Paediatric day-care chemotherapy sheet - induction Day 15 (22-Jun-2026)', date: '2026-06-22', inst: J.rushikonda, footNote: 'Day-care nursing record.',
    tests: 'paediatric chemo sheet: "Induction, Day 15" instead of a cycle number, regimen line with day numbers, previous Day 8 doses with their date, dated pre-chemo bloods, administration table (not prescriptions), Day 18 and Day 22 dates (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'chemotherapy_session_documented', date: '2026-06-22', match: 'Day 15' },
        { type: 'chemotherapy_session_documented', date: '2026-06-15', match: 'Day 8' },
        { type: 'regimen_documented', match: 'Phase 1A' },
        { type: 'lab_report_documented', date: '2026-06-21' },
      ],
    },
    blocks: [
      HEAD,
      title('PAEDIATRIC DAY-CARE CHEMOTHERAPY SHEET'),
      grid(
        ['Child', '*P. V. SAI TEJA', 'UHID', '*RCCC/26/04471'],
        ['Age / Sex', '8 Y / M', 'Date', '*22-Jun-2026'],
        ['Ht / Wt / BSA', '127 cm / 23.5 kg / 0.91 m2', 'Phase / Day', '*Induction, Day 15'],
        ['Protocol', 'ICiCLe-ALL-14, standard-risk arm', 'Consultant', 'Dr. Haritha Kolluri'],
      ),
      kv('Regimen:', 'Induction (Phase 1A) - Prednisolone 60 mg/m2/day D1 - 28; Vincristine 1.5 mg/m2 D1, 8, 15, 22; Daunorubicin 25 mg/m2 D1, 8, 15, 22; PEG-asparaginase 2,250 IU/m2 D4 and D18; IT methotrexate D1, 8 and 29.'),
      p('Previous: Day 8 doses given on 15/06/2026 (in-patient). End-of-induction marrow with MRD on Day 29.'),
      h('Pre-chemo assessment'),
      table(['Parameter', 'Value', 'Remark'], [0.32, 0.42, 0.26], [
        ['CBC, bilirubin, ALT (21/06/2026)', 'Hb 9.4 g/dL, ANC 820 /cumm, platelets 64,000 /cumm; bilirubin 0.9 mg/dL, ALT 64 U/L', 'Proceed as per protocol'],
        ['Weight / BP', '23.5 kg / 98/62 mmHg', 'Stable'],
        ['Neuropathy check', 'Mild jaw pain; walks and climbs stairs well', 'Continue vincristine'],
      ]),
      h('Drugs administered'),
      table(['Time', 'Drug and dose', 'Route', 'Given by'], [0.1, 0.56, 0.22, 0.12], [
        ['09:40', 'Inj. Ondansetron 2.5 mg (premedication)', 'IV', 'SR'],
        ['10:05', 'Inj. Vincristine 1.4 mg in 10 mL NS', 'IV push via PICC', 'SR'],
        ['10:15', 'Inj. Daunorubicin 23 mg in 50 mL NS', 'IV over 1 h', 'SR'],
        ['11:30', 'PICC flush (heparinised saline) and dressing change', '-', 'SR'],
      ]),
      p('Tolerated well; no vomiting. Prednisolone continues at home. Sent home at 12:10 with the mother. Next: Day 18 PEG-asparaginase on 25/06/2026 and Day 22 doses on 29/06/2026.'),
      sig({ name: 'Sr. Sravani Reddy', qual: 'B.Sc. Nursing, Paediatric Oncology Nursing Fellowship', role: 'Day-care nurse (SR)' }),
    ],
  },
  {
    patientKey: 'saiteja', n: 4, slug: 'usg-abdomen-wrong-patient', fmt: 'pdf', docType: 'imaging_report',
    title: 'Ultrasound abdomen and pelvis (24/06/2026), different patient', date: '2026-06-24', inst: J.visakha, footNote: 'Reported by a consultant radiologist.',
    tests: 'WRONG PATIENT: Ms. Pothula Sai Tejaswini, 13 Y / Female, different father and referring doctor (same surname, first name starts the same). Must be held',
    gold: {
      identity: 'mismatch',
      held: true,
      events: [
        { type: 'imaging_report_documented', date: '2026-06-24', match: 'Ultrasound' },
        { type: 'impression_documented', match: 'mesenteric lymphadenitis' },
      ],
    },
    blocks: [
      HEAD,
      title('ULTRASOUND ABDOMEN & PELVIS'),
      grid(
        ['Patient', '*Ms. POTHULA SAI TEJASWINI', 'Scan ID', '*VID/US/26/3381'],
        ['Age / Sex', '13 Y / Female', 'Date', '*24/06/2026'],
        ['Ref. by', 'Dr. K. Swathi (Paediatrics)', 'Father', 'Mr. P. Appala Naidu'],
        ['Indication', 'Pain abdomen (right lower quadrant) x 2 days, low-grade fever'],
      ),
      h('Findings'),
      ul(
        'Liver normal in size (12.4 cm) and echotexture; no focal lesion. Gall bladder, CBD, pancreas and spleen (8.9 cm) normal.',
        'Multiple enlarged, oval mesenteric lymph nodes in the right iliac fossa, largest 14 x 8 mm, with preserved fatty hila.',
        'Appendix visualised, 5 mm, compressible, with no surrounding collection. Minimal free fluid in the pelvis.',
        'Both kidneys normal in size with normal corticomedullary differentiation. Uterus and ovaries normal for age.',
      ),
      h('Impression'),
      p('Features suggestive of mesenteric lymphadenitis. Normal appendix. No other abnormality detected.', { bold: true }),
      sig(prasanna),
      END(),
    ],
  },

  // ---------------------------------------------------------------- deviram (Prostate, Shimla) ---------------------
  {
    patientKey: 'deviram', n: 1, slug: 'uro-oncology-opd-bullets', fmt: 'pdf', docType: 'consult_note',
    title: 'Urology and uro-oncology OPD (14-Apr-2026)', date: '2026-04-14', inst: J.jakhoo, footNote: 'OPD record. Valid with signature.',
    tests: 'consult note written entirely as bullets: dated PSA, biopsy HPE and bone scan inside bullets, TURP "about 5 years back" (no date), consultation section headed Impression with a cTNM stage, prescription "given separately" (no medicines in this note), review date (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'consultation_documented', date: '2026-04-14', match: 'Negi' },
        { type: 'lab_report_documented', date: '2026-04-12', match: 'PSA' },
        { type: 'pathology_report_documented', date: '2026-04-08' },
        { type: 'imaging_report_documented', date: '2026-04-13', match: 'Bone scan' },
        { type: 'impression_documented', match: 'Ca prostate' },
        { type: 'stage_documented', match: 'cT3a Nx M1b' },
      ],
    },
    blocks: [
      HEAD,
      title('UROLOGY & URO-ONCOLOGY OPD'),
      grid(
        ['Name', '*DEVI RAM CHAUHAN', 'OPD No.', '*JHU/OPD/26/2297'],
        ['Age / Sex', '72 / M', 'Date', '*14-Apr-2026'],
        ['Consultant', 'Dr. Rajinder Singh Negi', 'From', 'Village Kotkhai, Distt. Shimla'],
      ),
      ul(
        'C/o: poor stream, nocturia 4 - 5 times, low back pain x 3 months, worse at night.',
        'Past: TURP at Mandi about 5 years back. COPD on inhalers. Ex-smoker (quit 10 years ago).',
        'O/E: ECOG 1. DRE - hard, nodular prostate, both lobes; right side extending beyond the capsule; median sulcus obliterated. Tenderness over L2 - L3.',
        'S. PSA (12/04/2026): 86.4 ng/mL.',
        'TRUS biopsy HPE (08/04/2026): acinar adenocarcinoma, Gleason 4 + 4 = 8 (Grade Group 4) in 9 of 12 cores.',
        'Bone scan (13/04/2026): multiple skeletal metastases - spine, pelvis, ribs, right femur.',
      ),
      h('Impression'),
      p('Ca prostate, high-volume metastatic hormone-sensitive disease (cT3a Nx M1b).', { bold: true }),
      h('Plan'),
      ul(
        'Androgen deprivation: anti-androgen cover for 2 weeks, then an LHRH agonist depot - prescription given separately.',
        'Discussed adding abiraterone or docetaxel; to decide after CECT abdomen and LFT. Medical oncology opinion.',
        'MRI spine if the back pain increases or there is any weakness of the legs.',
        'Review after 3 weeks (05/05/2026) with PSA, LFT, RFT and blood sugar.',
      ),
      sig(negi),
    ],
  },
  {
    patientKey: 'deviram', n: 2, slug: 'bone-scan-mdp', fmt: 'pdf', docType: 'imaging_report',
    title: 'Tc-99m MDP whole-body bone scan (13th April 2026)', date: '2026-04-13', inst: J.sanjauli, footNote: 'Computer-generated report. Valid with signature.',
    tests: 'nuclear-medicine imaging: header name is the alias "Mr. DEVI RAM", ordinal date, dated PSA in the clinical details, undated biopsy (no fact), Impression',
    gold: {
      identity: 'match',
      events: [
        { type: 'imaging_report_documented', date: '2026-04-13', match: 'bone scan' },
        { type: 'lab_report_documented', date: '2026-04-12', match: 'PSA' },
        { type: 'impression_documented', match: 'Multiple osteoblastic' },
      ],
    },
    blocks: [
      HEAD,
      title('Tc-99m MDP WHOLE-BODY BONE SCAN'),
      grid(
        ['Patient', '*Mr. DEVI RAM', 'Study No.', '*SNM/BS/26/0412'],
        ['Age / Sex', '72 Y / M', 'Date of study', '*13th April 2026'],
        ['Referred by', 'Dr. R. S. Negi (Urology)', 'Radiopharmaceutical', 'Tc-99m MDP 20 mCi IV; images at 3 h'],
      ),
      kv('Clinical details:', 'Carcinoma prostate on TRUS biopsy (Gleason 8). S. PSA 86.4 ng/mL on 12/04/2026. Low back pain.'),
      h('Findings'),
      ul(
        'Multiple foci of increased tracer uptake in the cervical (C6), dorsal (D7, D10) and lumbar (L2, L3) vertebrae, the sacrum, both iliac bones, the right 4th and 7th ribs and the proximal shaft of the right femur.',
        'Physiological tracer distribution elsewhere; both kidneys visualised; urinary bladder normal.',
        'No superscan appearance.',
      ),
      h('Impression'),
      p('Multiple osteoblastic skeletal metastases involving the axial and appendicular skeleton (more than four lesions, including lesions beyond the vertebral bodies and pelvis), in keeping with high-volume metastatic disease. Suggest an X-ray or MRI of the right femur to assess fracture risk.', { bold: true }),
      sig(sood),
      END(),
    ],
  },
  {
    patientKey: 'deviram', n: 3, slug: 'prescription-handwritten', fmt: 'jpg', docType: 'prescription_handwritten',
    title: 'Prescription (handwritten) 14/4/26', date: '2026-04-14', inst: J.jakhoo, institution: 'Dr. Rajinder Singh Negi, Jakhoo Hills Urology & Cancer Centre', footNote: 'Photograph of prescription sheet.',
    photo: { angle: -1.1, paper: '#f6f2e6', desk: '#55493c', dx: 6, dy: 8, seed: 163 },
    tests: 'HANDWRITTEN prescription on a ruled sheet (ADT start): must be held, zero auto-extracted events',
    gold: { identity: 'insufficient', handwritten: true, held: true, events: [] },
    blocks: [],
    pages: () =>
      handwrittenRx({
        seed: 977, style: 'lined', doctor: 'Dr. RAJINDER SINGH NEGI', quals: 'M.S., M.Ch. (Urology)', clinic: 'Jakhoo Hills Urology & Cancer Centre',
        addr: 'Lakkar Bazar, Shimla 171 001', reg: 'Reg. No. HPMC-1849', ink: [0.2, 0.35, 0.15], pen: [0.08, 0.1, 0.38],
        name: 'Devi Ram Chauhan', agesex: '72 / M', date: '14/4/26', complaint: 'Ca prostate - bone mets',
        rx: ['1)  Tab. Bicalutamide 50 mg   1-0-0  x 14 d', '2)  Inj. Leuprolide 22.5 mg depot IM on 21/4', '3)  Tab. Calcium + Vit D3   0-1-0', '4)  Tab. Tamsulosin 0.4 mg   0-0-1'], review: 'Review 5/5 with PSA, LFT, RFT',
      }),
  },
  {
    patientKey: 'deviram', n: 4, slug: 'palliative-rt-summary', fmt: 'pdf', docType: 'radiotherapy_summary',
    title: 'Radiotherapy summary - palliative EBRT to lumbar spine (22/05/2026)', date: '2026-05-22', inst: J.himshikha, footNote: 'Computer-generated summary. Valid with signature.',
    tests: 'palliative RT summary: one-line header, dated MRI spine and dated PSA, undated earlier PSA and "since April 2026" (no facts), radiotherapy planning margin wording (not a margin fact), morphine in an advice line (not a prescription)',
    gold: {
      identity: 'match',
      events: [
        { type: 'radiotherapy_documented', match: '20 Gy' },
        { type: 'imaging_report_documented', date: '2026-05-10', match: 'MRI' },
        { type: 'lab_report_documented', date: '2026-05-15', match: 'PSA' },
      ],
    },
    blocks: [
      HEAD,
      title('RADIOTHERAPY SUMMARY', 'Palliative external beam radiotherapy'),
      p('Name: Devi Ram Chauhan      Age / Sex: 72 / M      RT No.: HRO/26/0157      Date: 22/05/2026'),
      kv('Diagnosis:', 'Adenocarcinoma prostate, Gleason 4 + 4, high-volume metastatic hormone-sensitive disease; on androgen deprivation since April 2026.'),
      kv('Indication:', 'Painful L2 - L3 vertebral metastases. MRI dorsolumbar spine (10/05/2026): L2 and L3 metastases with a small soft-tissue component; no cord compression, no collapse.'),
      kv('PSA:', '9.2 ng/mL on 15/05/2026 (86.4 ng/mL at diagnosis).'),
      h('Treatment'),
      table(['Parameter', 'Details'], [0.28, 0.72], [
        ['Site', 'L1 to L4 vertebrae (one vertebra above and below the involved levels, 1 cm lateral margin)'],
        ['Technique', '3D-CRT, AP-PA parallel opposed fields, 6 MV photons'],
        ['Dose', '20 Gy in 5 fractions, 4 Gy per fraction'],
        ['Dates', '18/05/2026 - 22/05/2026'],
        ['Interruptions', 'None'],
      ]),
      h('Response and toxicity'),
      p('Pain score fell from 7/10 to 3/10 by the last fraction; morphine requirement halved. Grade 1 nausea managed with ondansetron. No diarrhoea.'),
      h('Advice'),
      ul(
        'Continue androgen deprivation as per the urologist; next leuprolide depot due in July 2026.',
        'Tab. Morphine (immediate release) 10 mg SOS as per the pain clinic, with a laxative while on morphine.',
        'Review in RT OPD after 4 weeks; come earlier for weakness of the legs or difficulty passing urine.',
      ),
      sig(kanwar),
    ],
  },

  // ---------------------------------------------------------------- amit (Testicular GCT, Ranchi) ------------------
  {
    patientKey: 'amit', n: 1, slug: 'orchidectomy-discharge-summary', fmt: 'pdf', docType: 'discharge_summary',
    title: 'Discharge summary - right high inguinal orchidectomy (5th July 2026)', date: '2026-07-05', inst: J.subarnarekha, footNote: 'Discharge summary. Valid with signature.',
    tests: 'discharge: admitted / operated / discharged on one key-value line in ordinal dates, childhood orchidopexy (no date), dated USG and dated tumour markers, undated chest X-ray (no fact), "Specimen sent for HPE", four discharge medicines incl. an ointment, suture-removal date (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'admission_documented', date: '2026-07-02' },
        { type: 'procedure_documented', date: '2026-07-03', match: 'orchidectomy' },
        { type: 'discharge_documented', date: '2026-07-05' },
        { type: 'imaging_report_documented', date: '2026-06-29', match: 'USG scrotum' },
        { type: 'lab_report_documented', date: '2026-07-01', match: 'AFP' },
        { type: 'report_pending_documented', match: 'HPE' },
        ...rx('Cefuroxime', 'Paracetamol', 'Pantoprazole', 'Povidone-iodine'),
      ],
    },
    blocks: [
      HEAD,
      title('DISCHARGE SUMMARY', 'Department of Surgical Oncology (Uro-oncology unit)'),
      kv('Name:', 'Mr. AMIT KUMAR MUNDA      Age / Sex: 22 yrs / Male      IPD No.: SCH/IPD/26/2741'),
      kv('Admitted on:', '2nd July 2026      Operated on: 3rd July 2026      Discharged on: 5th July 2026'),
      kv('Consultant:', 'Dr. Prashant Tirkey, M.Ch. (Surgical Oncology)'),
      h('Diagnosis'),
      p('Right testicular tumour (clinically non-seminomatous germ cell tumour) with raised tumour markers.'),
      h('History'),
      p('Painless progressive swelling of the right testis x 4 months, dull ache in the right groin, dry cough x 3 weeks. Right undescended testis operated (orchidopexy) in childhood. No other illness. College student.'),
      h('Investigations'),
      ul(
        'USG scrotum (29/06/2026): 4.8 x 3.6 cm heterogeneous solid-cystic mass replacing most of the right testis, with internal vascularity; left testis normal.',
        'Tumour markers before surgery (01/07/2026): AFP 1,240 ng/mL, beta-hCG 3,850 mIU/mL, LDH 610 U/L.',
        'Chest X-ray: two small nodular opacities in the right lower zone - CECT chest and abdomen advised.',
      ),
      h('Operation'),
      p('Right high inguinal orchidectomy on 03/07/2026 under spinal anaesthesia: cord clamped at the deep ring before mobilising the testis, then transfixed and ligated. Testicular prosthesis declined. Specimen sent for HPE.', { bold: true }),
      h('Post-operative course'),
      p('Uneventful. Ambulant on day 1; wound healthy. Semen cryopreservation was completed in the hospital andrology laboratory before surgery.'),
      h('Discharge medicines'),
      table(['Medicine', 'Dose / timing', 'Duration'], [0.48, 0.34, 0.18], [
        ['Tab. Cefuroxime axetil 500 mg', '1-0-1 after food', '5 days'],
        ['Tab. Paracetamol 650 mg', '1-1-1 if pain', '5 days'],
        ['Tab. Pantoprazole 40 mg', '1-0-0 before breakfast', '5 days'],
        ['Povidone-iodine 5 % ointment', 'Local application on the wound, once daily', '7 days'],
      ]),
      h('Follow-up'),
      ul(
        'Suture removal on 12/07/2026.',
        'Review in OPD with the HPE report and CECT chest, abdomen and pelvis; repeat AFP, beta-hCG and LDH 7 - 10 days after surgery.',
        'Medical oncology consultation for chemotherapy.',
      ),
      sig(tirkey),
    ],
  },
  {
    patientKey: 'amit', n: 2, slug: 'orchidectomy-histopathology', fmt: 'pdf', docType: 'pathology_report',
    title: 'Histopathology - right high inguinal orchidectomy (10-Jul-2026)', date: '2026-07-10', inst: J.chotanagpur, footNote: 'Computer-generated report. Valid with signature.',
    tests: 'pathology: dd-Mon-yyyy received / reported dates, operation date in the specimen cell, percentages of germ cell components, synoptic table with a spermatic cord margin row and a pT-only row, IHC mentioned without results (no marker rows)',
    gold: {
      identity: 'match',
      events: [
        { type: 'pathology_report_documented', date: '2026-07-10' },
        { type: 'procedure_documented', date: '2026-07-03', match: 'orchidectomy' },
        { type: 'margins_documented', match: 'Spermatic cord resection margin' },
        { type: 'stage_documented', match: 'pT2' },
      ],
    },
    blocks: [
      HEAD,
      title('HISTOPATHOLOGY REPORT'),
      grid(
        ['Name', '*AMIT KUMAR MUNDA', 'Path No.', '*CPL/H/26/4418'],
        ['Age / Sex', '22 / M', 'Sample received', '04-Jul-2026'],
        ['Referred by', 'Dr. Prashant Tirkey, Subarnarekha Cancer Hospital', 'Date of report', '*10-Jul-2026'],
        ['Specimen', 'Right high inguinal orchidectomy (operated 03-Jul-2026)', 'Clinical', 'Testicular mass; AFP and beta-hCG raised'],
      ),
      h('Gross'),
      p('Testis with epididymis and spermatic cord (9 cm). Testis 6 x 4.5 x 4 cm; cut surface shows a variegated grey-white to yellow tumour 4.7 cm with haemorrhage, necrosis and small cysts, replacing most of the testis and abutting the tunica albuginea. Cord cut end inked.'),
      h('Microscopy'),
      p('Mixed germ cell tumour: embryonal carcinoma (about 60 %), yolk sac tumour (about 30 %, reticular and microcystic patterns) and mature teratoma (about 10 %). No seminoma or choriocarcinoma component. Germ cell neoplasia in situ in the adjacent tubules.'),
      h('Synoptic summary'),
      table(['Parameter', 'Finding'], [0.36, 0.64], [
        ['Tumour size', '4.7 cm'],
        ['Rete testis', 'Stromal invasion present'],
        ['Tunica albuginea / vaginalis', 'Albuginea breached focally; tunica vaginalis free'],
        ['Lymphovascular invasion', '*Present'],
        ['Epididymis', 'Free'],
        ['Spermatic cord resection margin', 'Free of tumour'],
        ['pT (AJCC 8th ed.)', '*pT2'],
      ]),
      h('Final diagnosis'),
      p('Right testis, high inguinal orchidectomy: MIXED GERM CELL TUMOUR (embryonal carcinoma 60 %, yolk sac tumour 30 %, teratoma 10 %) with lymphovascular invasion.', { bold: true }),
      p('Immunohistochemistry (OCT3/4, SALL4, glypican-3, CD30) supports the components described; slides available for review.', { italic: true }),
      sig(ekka),
      END(),
    ],
  },
  {
    patientKey: 'amit', n: 3, slug: 'medical-oncology-opd-tabular', fmt: 'pdf', docType: 'consult_note',
    title: 'Medical oncology OPD case record (16/07/2026)', date: '2026-07-16', inst: J.subarnarekha, footNote: 'OPD record. Valid with signature.',
    tests: 'consult note as a two-column form table plus a dated investigations table (date column first): pre- and post-operative markers on different dates, HPE row with a cord margin statement, CECT row, stage line with S category, "Assessment" not Impression, BEP start date (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'consultation_documented', date: '2026-07-16', match: 'Hembrom' },
        { type: 'imaging_report_documented', date: '2026-06-29', match: 'USG scrotum' },
        { type: 'lab_report_documented', date: '2026-07-01', match: 'pre-op' },
        { type: 'pathology_report_documented', date: '2026-07-10', match: 'HPE' },
        { type: 'margins_documented', match: 'cord margin free' },
        { type: 'imaging_report_documented', date: '2026-07-14', match: 'CECT' },
        { type: 'lab_report_documented', date: '2026-07-15', match: 'post-op' },
        { type: 'stage_documented', match: 'pT2 N2 M1a S2' },
      ],
    },
    blocks: [
      HEAD,
      title('MEDICAL ONCOLOGY OPD - CASE RECORD'),
      table(['Field', 'Details'], [0.24, 0.76], [
        ['Date', '*16/07/2026'],
        ['Patient', '*Amit Kumar Munda, 22 Y / M, UHID SCH/26/11902'],
        ['Seen by', 'Dr. Sweta Hembrom (Medical Oncology)'],
        ['Referred by', 'Dr. Prashant Tirkey (Surgical Oncology)'],
        ['Complaints', 'Post right high inguinal orchidectomy; dry cough x 1 month; no breathlessness or back pain'],
        ['Past history', 'Right orchidopexy in childhood. Non-smoker, no alcohol. No co-morbidity.'],
        ['Examination', 'ECOG 0. Healed right inguinal scar. Vague epigastric fullness; no supraclavicular nodes; no gynaecomastia. Chest clear.'],
      ]),
      h('Investigations'),
      table(['Date', 'Investigation', 'Result'], [0.14, 0.3, 0.56], [
        ['29/06/2026', 'USG scrotum', 'Right testicular solid-cystic mass 4.8 cm'],
        ['01/07/2026', 'AFP / beta-hCG / LDH (pre-op)', '1,240 ng/mL / 3,850 mIU/mL / 610 U/L'],
        ['10/07/2026', 'HPE (orchidectomy)', 'Mixed GCT (EC 60 %, YST 30 %, teratoma 10 %), LVI present, cord margin free'],
        ['14/07/2026', 'CECT chest, abdomen and pelvis', 'Interaortocaval and left para-aortic nodal mass 4.2 x 3.5 cm; three lung nodules, largest 1.4 cm; no liver or bone lesions'],
        ['15/07/2026', 'AFP / beta-hCG / LDH (post-op)', '1,020 ng/mL / 1,960 mIU/mL / 540 U/L'],
      ]),
      kv('Assessment:', 'Non-seminomatous germ cell tumour, right testis, stage IIIB (pT2 N2 M1a S2); IGCCCG intermediate prognosis.'),
      h('Plan'),
      ul(
        'BEP x 4 cycles (bleomycin, etoposide, cisplatin; 5-day schedule every 21 days). Cycle 1 to start on 20/07/2026 in Day-Care.',
        'Baseline PFT with DLCO, audiometry, RFT and creatinine clearance before chemotherapy.',
        'Semen cryopreservation already done.',
        'Markers before every cycle; CECT after 4 cycles; RPLND if a residual mass of more than 1 cm.',
      ),
      sig(hembrom),
    ],
  },
  {
    patientKey: 'amit', n: 4, slug: 'bep-daycare-c2d1', fmt: 'pdf', docType: 'chemo_daycare_record',
    title: 'Day-care chemotherapy record - BEP C2D1 (10-Aug-2026)', date: '2026-08-10', inst: J.subarnarekha, footNote: 'Day-care nursing record.',
    tests: 'chemo record: "Cycle 2, Day 1 (C2D1) of 4", stage in the diagnosis cell, regimen line, C1D1 and two bleomycin doses with their own dates, dated pre-chemo markers and bloods in one row, hydration and premedication in the administration table (not prescriptions), D2 - D5 and D8 dates (future)',
    gold: {
      identity: 'match',
      events: [
        { type: 'chemotherapy_session_documented', date: '2026-08-10', match: 'Cycle 2' },
        { type: 'chemotherapy_session_documented', date: '2026-07-20', match: 'C1D1' },
        { type: 'chemotherapy_session_documented', date: '2026-07-27', match: 'bleomycin' },
        { type: 'chemotherapy_session_documented', date: '2026-08-03', match: 'bleomycin' },
        { type: 'regimen_documented', match: 'BEP' },
        { type: 'lab_report_documented', date: '2026-08-09', match: 'AFP' },
        { type: 'stage_documented', match: 'stage IIIB' },
      ],
    },
    blocks: [
      HEAD,
      title('DAY-CARE CHEMOTHERAPY RECORD', 'Medical Oncology Day-Care'),
      grid(
        ['Patient', '*Mr. Amit K. Munda', 'Day-care No.', '*SCH/DC/26/0874'],
        ['Age / Sex', '22 / M', 'Date', '*10-Aug-2026'],
        ['Diagnosis', 'Mixed GCT right testis, stage IIIB, IGCCCG intermediate', 'Consultant', 'Dr. Sweta Hembrom'],
        ['Ht / Wt / BSA', '172 cm / 61 kg / 1.71 m2', 'Cycle / Day', '*Cycle 2, Day 1 (C2D1) of 4'],
      ),
      kv('Regimen:', 'BEP every 21 days - Bleomycin 30 units IV D1, D8, D15; Etoposide 100 mg/m2 IV D1 - 5; Cisplatin 20 mg/m2 IV D1 - 5; primary G-CSF prophylaxis.'),
      p('Cycle 1 (C1D1) started on 20/07/2026; D8 and D15 bleomycin given on 27/07/2026 and 03/08/2026. Tolerated with Grade 2 nausea and Grade 1 tinnitus.'),
      h('Pre-chemo check'),
      table(['Parameter', 'Value', 'Remark'], [0.3, 0.46, 0.24], [
        ['AFP, beta-hCG, LDH; CBC, RFT (09/08/2026)', 'AFP 96 ng/mL, beta-hCG 41 mIU/mL, LDH 238 U/L; Hb 11.6 g/dL, ANC 3,900 /cumm, platelets 2.4 lakh; creatinine 0.9 mg/dL', 'Markers falling; proceed'],
        ['Lungs (bleomycin)', 'No crepitations; SpO2 98 % on room air', 'Continue bleomycin'],
        ['Hearing', 'Mild tinnitus, no hearing loss', 'Audiometry before C3'],
      ]),
      h('Drugs administered (Day 1)'),
      table(['Time', 'Drug and dose', 'Route', 'Sign'], [0.1, 0.58, 0.22, 0.1], [
        ['09:30', 'Inj. Palonosetron 0.25 mg + Inj. Dexamethasone 12 mg + Cap. Aprepitant 125 mg (premedication)', 'IV / oral', 'RK'],
        ['10:00', 'Pre-hydration: 1 L NS with 20 mmol KCl and 2 g magnesium sulphate', 'IV over 2 h', 'RK'],
        ['12:00', 'Inj. Bleomycin 30 units in 100 mL NS', 'IV over 30 min', 'RK'],
        ['12:40', 'Inj. Etoposide 170 mg in 500 mL NS', 'IV over 1 h', 'RK'],
        ['13:45', 'Inj. Cisplatin 34 mg in 500 mL NS with Mannitol 100 mL', 'IV over 1 h', 'RK'],
        ['14:50', 'Post-hydration 1 L NS', 'IV', 'RK'],
      ]),
      p('No reaction; urine output adequate. D2 - D5 in Day-Care daily (11/08/2026 to 14/08/2026); Inj. Pegfilgrastim 6 mg SC on 15/08/2026; D8 bleomycin on 17/08/2026.'),
      sig({ name: 'Sr. Rashmi Kujur', qual: 'B.Sc. Nursing, Oncology Nursing Certificate', role: 'Day-care nurse (RK)' }),
    ],
  },
]

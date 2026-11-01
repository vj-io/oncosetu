import { describe, expect, it } from 'vitest'
import { parseHeader } from './header'

type Exp = { name?: string; age?: string; years?: number; sex?: 'M' | 'F' | 'O'; mrn?: string; mrnLabel?: string; dob?: string; date?: string; institution?: string; ref?: string }

// 34 header layouts seen on Indian hospital / lab / imaging documents.
const FORMATS: [string, Exp][] = [
  ['CITY CANCER HOSPITAL, PUNE\nName: Sunita Sharma      Age/Sex: 52 Y / F\nUHID: CCH-001234   Date: 15/03/2026', { name: 'Sunita Sharma', age: '52 Y', years: 52, sex: 'F', mrn: 'CCH-001234', mrnLabel: 'UHID', date: '15/03/2026', institution: 'CITY CANCER HOSPITAL, PUNE' }],
  ['Metro Diagnostics Pvt Ltd\nPatient Name : Mrs. SUNITA SHARMA\nAge / Gender : 52 Yrs / Female\nLab No : 260315001\nCollected On : 15-Mar-2026 09:10\nReported On : 15-Mar-2026 17:45', { name: 'Mrs. SUNITA SHARMA', age: '52 Yrs', years: 52, sex: 'F', mrn: '260315001', mrnLabel: 'Lab No', date: '15-Mar-2026', institution: 'Metro Diagnostics Pvt Ltd' }],
  ['Pt. Name: Ramesh Gupta  Age: 61 Years  Sex: M\nMRN 4455667', { name: 'Ramesh Gupta', age: '61 Years', years: 61, sex: 'M', mrn: '4455667', mrnLabel: 'MRN' }],
  ['Name of Patient : Mohd. Rafiq Khan\nSex/Age: M/66 Y\nIP No.: IP/26/0042', { name: 'Mohd. Rafiq Khan', age: '66 Y', years: 66, sex: 'M', mrn: 'IP/26/0042', mrnLabel: 'IP No' }],
  ['Patient Name: Anita Verma | Age: 45 | Gender: Female | UHID: 99812', { name: 'Anita Verma', age: '45', years: 45, sex: 'F', mrn: '99812' }],
  ['Name : Lakshmi Iyer        52Y/F\nReg. No : R-2026-1199', { name: 'Lakshmi Iyer', age: '52Y', years: 52, sex: 'F', mrn: 'R-2026-1199', mrnLabel: 'Reg No' }],
  ['Name: Priya Nair Age: 34 Yrs Sex: Female', { name: 'Priya Nair', age: '34 Yrs', years: 34, sex: 'F' }],
  ['NAME : DEEPAK JOSHI\nAGE : 58 YRS\nSEX : MALE\nCR No : 2026/123456', { name: 'DEEPAK JOSHI', age: '58 YRS', years: 58, sex: 'M', mrn: '2026/123456', mrnLabel: 'CR No' }],
  ['Patient : Ms. Kavita Rao\nPatient Name: Kavita Rao\nAge: 29 years, Sex: F', { name: 'Kavita Rao', age: '29 years', years: 29, sex: 'F' }],
  ["Patient's Name: Fatima Shaikh  DOB: 12/03/1974  Sex: Female", { name: 'Fatima Shaikh', sex: 'F', dob: '12/03/1974' }],
  ['Name: Baby Ananya Das   Age: 6 M   Sex: F', { name: 'Baby Ananya Das', age: '6 M', years: 0.5, sex: 'F' }],
  ['Name: Arjun Reddy  Age: 15 D  Sex: M', { name: 'Arjun Reddy', age: '15 D', sex: 'M' }],
  ['नाम: सुनीता शर्मा\nउम्र: 52 वर्ष\nलिंग: महिला', { name: 'सुनीता शर्मा', age: '52 वर्ष', years: 52, sex: 'F' }],
  ['रोगी का नाम : राजेश गुप्ता   आयु : ६१ साल   लिंग : पुरुष', { name: 'राजेश गुप्ता', age: '६१ साल', years: 61, sex: 'M' }],
  ['Name: Sunita W/o Ramesh Sharma   Age: 52 Y   Sex: F', { name: 'Sunita W/o Ramesh Sharma', age: '52 Y', sex: 'F' }],
  ['Patient Name: Vijay Kumar S/O Late Mohan Lal\nAge/Sex : 47Y/M', { name: 'Vijay Kumar S/O Late Mohan Lal', age: '47Y', years: 47, sex: 'M' }],
  ['Name: S. K. Patil   Age: 70   Sex: M', { name: 'S. K. Patil', age: '70', sex: 'M' }],
  ['Referring Doctor: Dr. A. Mehta\nName: Shalini Ghosh\nAge: 40 Y Sex: F\nPatient ID: PID778899', { name: 'Shalini Ghosh', age: '40 Y', sex: 'F', mrn: 'PID778899', mrnLabel: 'Patient ID' }],
  ['Name : Mr. Amit Bose\nAge(Yrs) : 39\nGender : M\nOPD No : OP-55621\nVisit Date : 02/11/2026', { name: 'Mr. Amit Bose', age: '39', sex: 'M', mrn: 'OP-55621', mrnLabel: 'OP No', date: '02/11/2026' }],
  ['Patient Name\t: Meena Pillai\tAge\t: 63 Y\tSex\t: F', { name: 'Meena Pillai', age: '63 Y', sex: 'F' }],
  ['Pt Name: Rahul Mishra, Age: 22, Sex: Male, Hosp. No: 777123', { name: 'Rahul Mishra', age: '22', sex: 'M', mrn: '777123', mrnLabel: 'Hospital No' }],
  ['Name: Usha Kulkarni\nD.O.B: 05-Jun-1960\nGender: Female\nMR No: 00012345', { name: 'Usha Kulkarni', sex: 'F', dob: '05-Jun-1960', mrn: '00012345', mrnLabel: 'MRN' }],
  ['Name: Geeta Yadav  Age: 50 Yrs  Sex: F\nRef. By: Dr. S. Rao\nReport Date: 20/03/2026', { name: 'Geeta Yadav', sex: 'F', date: '20/03/2026', ref: 'Dr. S. Rao' }],
  ['Name: Naveen Chauhan  Age: 33  Sex: M\nReferred By : SELF\nDated: 01.04.2026', { name: 'Naveen Chauhan', sex: 'M', date: '01.04.2026' }],
  ['Name : Pooja Jain    Age/Sex : 27 Yrs/Female    Sample ID : S-445566\nSample Collected On : 03/04/2026', { name: 'Pooja Jain', age: '27 Yrs', sex: 'F', mrn: 'S-445566', mrnLabel: 'Sample ID', date: '03/04/2026' }],
  ['Patient Name : Imran Qureshi\nAge : 55 Y Gender : M\nIPD No: 26-1102\nDate of Report: 12 April 2026', { name: 'Imran Qureshi', age: '55 Y', sex: 'M', mrn: '26-1102', mrnLabel: 'IP No', date: '12 April 2026' }],
  ['Name: Seema Thakur Age: 44 Sex: Female Regn No: 556677 Date: 12-04-26', { name: 'Seema Thakur', age: '44', sex: 'F', mrn: '556677', mrnLabel: 'Reg No', date: '12-04-26' }],
  ['Name: Joseph Fernandes   48 Yrs / Male\nUHID No: MH-778', { name: 'Joseph Fernandes', age: '48 Yrs', sex: 'M', mrn: 'MH-778', mrnLabel: 'UHID' }],
  ['Consultant: Dr. P. Banerjee\nPatient Name: Rekha Banerjee  Age: 58  Sex: F', { name: 'Rekha Banerjee', sex: 'F', ref: 'Dr. P. Banerjee' }],
  ['Name of the Patient: Salim Ansari\nAge: 72 Y\nSex: M\nDate of Birth: 1954', { name: 'Salim Ansari', age: '72 Y', sex: 'M' }],
  ['Name: Mamta Singh  Age: 36 Y  Sex: F\nCollection Date: 14/04/2026\nReported: 15/04/2026', { name: 'Mamta Singh', sex: 'F', date: '15/04/2026' }],
  ['Doctor Name: Dr Rao\nPatient Name: Swati Deshpande  Age 31 Sex F', { name: 'Swati Deshpande', sex: 'F' }],
  ['Page 1 of 2\nTATA MEMORIAL HOSPITAL\nName: Archana Menon Age: 49 Y Sex: F', { name: 'Archana Menon', institution: 'TATA MEMORIAL HOSPITAL' }],
  ['दिनांक: १२/०४/२०२६\nनाम: अनीता वर्मा', { name: 'अनीता वर्मा', date: '१२/०४/२०२६' }],
]

describe('parseHeader: header formats', () => {
  it('has ≥ 30 formats', () => expect(FORMATS.length).toBeGreaterThanOrEqual(30))

  it.each(FORMATS.map(([t, e], i) => [i, t.split('\n')[0].slice(0, 40), t, e] as const))('#%i %s', (_i, _l, text, e) => {
    const h = parseHeader(text)
    const spanOk = (s?: { value: string; start: number; end: number }) => s && expect(text.slice(s.start, s.end)).toBe(s.value)
    if (e.name) expect(h.name?.value).toBe(e.name)
    if (e.age) expect(h.age?.value).toBe(e.age)
    if (e.years !== undefined) expect(h.age?.years).toBeCloseTo(e.years, 5)
    if (e.sex) expect(h.sex?.sex).toBe(e.sex)
    if (e.mrn) expect(h.mrn?.value).toBe(e.mrn)
    if (e.mrnLabel) expect(h.mrn?.label).toBe(e.mrnLabel)
    if (e.dob) expect(h.dob?.value).toBe(e.dob)
    if (e.date) expect(h.reportDate?.value).toBe(e.date)
    if (e.institution) expect(h.institution?.value).toBe(e.institution)
    if (e.ref) expect(h.referringDoctor?.value).toBe(e.ref)
    // every span is an exact slice of the text (so it can be gated / stored as evidence)
    for (const s of [h.name, h.age, h.sex, h.dob, h.mrn, h.reportDate, h.institution, h.referringDoctor, ...h.ids]) spanOk(s)
  })

  it('does not read "Page 1" as an age or "Doctor Name" as the patient', () => {
    const h = parseHeader('Page 1 of 3\nDoctor Name: Dr Rao')
    expect(h.age).toBeUndefined()
    expect(h.name).toBeUndefined()
  })

  it('DOB is never taken as the report date', () => {
    const h = parseHeader('Name: Sunita Sharma\nDate of Birth: 12/03/1974')
    expect(h.dob?.value).toBe('12/03/1974')
    expect(h.reportDate).toBeUndefined()
  })

  it('label offsets allow label..value quotes', () => {
    const text = 'X\nReported On : 15/03/2026'
    const h = parseHeader(text)
    expect(text.slice(h.reportDate!.labelStart, h.reportDate!.end)).toBe('Reported On : 15/03/2026')
  })
})

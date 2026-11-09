import { describe, expect, it } from 'vitest'
import {
  ageOn,
  compareNames,
  decideIdentity,
  jaroWinkler,
  normaliseName,
  normaliseSex,
  parseAge,
  phoneticKey,
  transliterate,
  type HeaderIdentity,
  type PatientIdentity,
} from '.'

describe('transliterate (Devanagari → Latin)', () => {
  it.each([
    ['सुनीता शर्मा', 'suneetaa sharmaa'],
    ['राम', 'raam'],
    ['कमला', 'kamlaa'],
    ['मोहम्मद', 'mohammad'],
    ['लक्ष्मी', 'lakshmee'],
    ['रफ़ीक', 'rafeek'],
    ['यादव', 'yaadav'],
    ['विजय', 'vijay'],
    ['जगदीश', 'jagdeesh'],
    ['भरत', 'bharat'],
    ['अंसारी', 'ansaaree'],
  ])('%s → %s', (dev, latin) => expect(transliterate(dev)).toBe(latin))
})

describe('phoneticKey', () => {
  it.each([
    ['Sharma', 'Sarma'],
    ['Laxmi', 'Lakshmi'],
    ['Mohd', 'Muhammad'],
    ['Md', 'Mohammed'],
    ['Pooja', 'Puja'],
    ['Deepak', 'Dipak'],
    ['Sunitha', 'Sunita'],
    ['Waseem', 'Vaseem'],
    ['Zakir', 'Jakir'],
    ['Farooque', 'Farooq'],
    ['Rafique', 'Rafiq'],
    ['Sanjay', 'Sanjai'],
    ['Aggarwal', 'Agarwal'],
    ['Banerjee', 'Banerji'],
    ['Mukherjee', 'Mukerji'],
    ['Shrivastava', 'Srivastava'],
    ['Kumari', 'Kumar'],
    ['Verma', 'Varma'],
    ['Phool', 'Fool'],
  ])('%s ≡ %s', (a, b) => expect(phoneticKey(a)).toBe(phoneticKey(b)))

  it.each([
    ['Sharma', 'Verma'],
    ['Gupta', 'Gupte'],
    ['Priya', 'Piya'],
    ['Ramesh', 'Rajesh'],
    ['Manish', 'Manisha'],
  ])('%s ≢ %s', (a, b) => expect(phoneticKey(a)).not.toBe(phoneticKey(b)))
})

describe('jaroWinkler', () => {
  it('known values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3)
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.813, 3)
    expect(jaroWinkler('abc', 'abc')).toBe(1)
    expect(jaroWinkler('', 'abc')).toBe(0)
    expect(jaroWinkler('abc', 'xyz')).toBe(0)
  })
})

describe('normaliseName', () => {
  it('strips honorifics and relation clauses', () => {
    expect(normaliseName('Smt. Sunita Sharma W/o Ramesh Sharma').plain).toEqual(['sunita', 'sharma'])
    expect(normaliseName('Mr. Rajesh Gupta S/O Late Mohan Gupta').plain).toEqual(['rajesh', 'gupta'])
    expect(normaliseName('Kum. Anjali d/o Suresh').plain).toEqual(['anjali'])
    expect(normaliseName('Dr. Mohd. Rafiq').tokens).toEqual(['mohammad', 'rafik'])
    expect(normaliseName('श्रीमती सुनीता शर्मा').tokens).toEqual(['sunita', 'sarma'])
    expect(normaliseName('सुनीता पत्नी रमेश').tokens).toEqual(['sunita'])
    expect(normaliseName('Kumari Sunita').tokens).toEqual(['sunita'])
    expect(normaliseName('Kumar Gaurav').tokens).toEqual(['kumar', 'gaurav'])
    expect(normaliseName('Baby Ananya').tokens).toEqual(['ananya'])
  })
  it('initials', () => {
    expect(normaliseName('S.K. Sharma')).toMatchObject({ tokens: ['sarma'], initials: ['s', 'k'] })
    expect(normaliseName('SK SHARMA')).toMatchObject({ tokens: ['sarma'], initials: ['s', 'k'] })
    expect(normaliseName('MD RAFIQ').tokens).toEqual(['mohammad', 'rafik'])
  })
  it('baby-of clause', () => {
    expect(normaliseName('B/O Sunita Sharma').babyOf).toBe(true)
    expect(normaliseName('Baby of Sunita').babyOf).toBe(true)
    expect(normaliseName('Baby Ananya').babyOf).toBe(false)
  })
})

describe('compareNames', () => {
  it.each([
    ['Sunita Sharma', 'Sunita Sharma', 'match'],
    ['SHARMA, SUNITA', 'Sunita Sharma', 'match'],
    ['Sunita Sarma', 'Sunita Sharma', 'match'],
    ['सुनीता शर्मा', 'Sunita Sharma', 'match'],
    ['Saikumar Reddy', 'Sai Kumar Reddy', 'match'],
    ['Sunita Sharma', 'Sunita Devi Sharma', 'match'],
    ['Sunil K. Sharma', 'Sunil Kumar Sharma', 'match'],
    ['Choudhary Ramesh', 'Ramesh Chaudhary', 'match'],
    ['Mrs. MEENATCHI SUNDARESAN', 'Meenakshi Sundaresan', 'match'], // Tamil -tchi for -kshi
    ['Kamatchi Raman', 'Meenakshi Raman', 'mismatch'],
    ['Sunita Verma', 'Sunita Sharma', 'mismatch'],
    ['Anita Sharma', 'Sunita Sharma', 'mismatch'],
    ['Priya Gupta', 'Piya Gupta', 'mismatch'],
    ['R. Sharma', 'Sunil Sharma', 'mismatch'],
    ['Sunita', 'Sunita Sharma', 'insufficient'],
    ['S. Sharma', 'Sunita Sharma', 'insufficient'],
    ['S.S.', 'Sunita Sharma', 'insufficient'],
    ['Mr. SHETTY', 'Mr. R. V. Shetty', 'insufficient'], // a surname alone against an initials-and-surname alias
    ['R. V. Shetty', 'Mr. R. V. Shetty', 'match'],
    ['', 'Sunita Sharma', 'insufficient'],
  ])('%s vs %s → %s', (h, p, verdict) => expect(compareNames(h, p).verdict).toBe(verdict))
})

describe('parseAge / normaliseSex / ageOn', () => {
  it.each([
    ['52 Y', 52], ['52Y', 52], ['52 Yrs', 52], ['52 years', 52], ['52 yrs 3 months', 52], ['52', 52],
    ['52 वर्ष', 52], ['५२ साल', 52], ['6 M', 0.5], ['18 months', 1.5], ['15 D', 15 / 365], ['52 M', 52],
    [52, 52], ['N/A', null], [null, null],
  ] as const)('parseAge(%s) = %s', (raw, years) => {
    const a = parseAge(raw)
    if (years === null) expect(a).toBeNull()
    else expect(a).toBeCloseTo(years, 5)
  })
  it.each([
    ['M', 'M'], ['Male', 'M'], ['पुरुष', 'M'], ['F', 'F'], ['Female', 'F'], ['female.', 'F'], ['महिला', 'F'],
    ['स्त्री', 'F'], ['TG', 'O'], ['Other', 'O'], ['', null], ['X', null],
  ] as const)('normaliseSex(%s) = %s', (raw, sex) => expect(normaliseSex(raw)).toBe(sex))
  it('ageOn', () => {
    expect(ageOn('1974-03-12', '2026-03-11')).toBe(51)
    expect(ageOn('1974-03-12', '2026-03-12')).toBe(52)
  })
})

describe('decideIdentity: E-ID cases', () => {
  const patient: PatientIdentity = { name: 'Sunita Sharma', dob: '1974-03-12', sex: 'F', mrns: ['CCH-001234'] }
  const d = (h: HeaderIdentity, rd: string | null = '2026-03-15') => decideIdentity(patient, h, rd)

  it('match with age at report date', () => {
    expect(d({ name: 'Smt. Sunita Sharma', age: '52 Y', sex: 'F' })).toMatchObject({ result: 'match', reasons: [] })
  })
  it('age tolerance ±1 year', () => {
    expect(d({ name: 'Sunita Sharma', age: '53 Yrs', sex: 'F' }).result).toBe('match')
    expect(d({ name: 'Sunita Sharma', age: '51', sex: 'F' }).result).toBe('match')
    expect(d({ name: 'Sunita Sharma', age: '54', sex: 'F' })).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch'] })
  })
  it('E-ID-01 different name → mismatch', () => {
    expect(d({ name: 'Anita Verma', age: '52', sex: 'F' })).toMatchObject({ result: 'mismatch', reasons: ['name_mismatch'] })
  })
  it('E-ID-02 transliteration variants → match with note', () => {
    const r = d({ name: 'Sunita Sarma', age: '52', sex: 'F' })
    expect(r.result).toBe('match')
    expect(r.notes).toContain('transliteration_variant')
    expect(d({ name: 'सुनीता शर्मा', age: '५२ वर्ष', sex: 'महिला' }).result).toBe('match')
    const m = decideIdentity({ name: 'Mohammed Rafique Khan', dob: '1960-01-01', sex: 'M' }, { name: 'Mohd. Rafiq Khan', age: '66 Y', sex: 'Male' }, '2026-03-15')
    expect(m.result).toBe('match')
  })
  it('E-ID-03 initials only / no name → insufficient', () => {
    expect(d({ name: 'S. S.', age: '52', sex: 'F' })).toMatchObject({ result: 'insufficient', reasons: ['name_initials_only'] })
    expect(d({ name: null, age: '52', sex: 'F' })).toMatchObject({ result: 'insufficient', reasons: ['name_missing'] })
    expect(d({ name: 'Sunita', age: '52', sex: 'F' })).toMatchObject({ result: 'insufficient', reasons: ['single_name_token'] })
  })
  it('E-ID-04 same name, age mismatch > 1 year → mismatch', () => {
    expect(d({ name: 'Sunita Sharma', age: '34 Y', sex: 'F' })).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch'] })
    expect(d({ name: 'Sunita Sharma', dob: '12/03/1990', sex: 'F' })).toMatchObject({ result: 'mismatch', reasons: ['dob_mismatch'] })
  })
  it('E-ID-05 married name on alias list → match with note', () => {
    const p: PatientIdentity = { name: 'Priya Verma', aliases: ['Priya Sharma'], dob: '1990-05-20', sex: 'F' }
    const r = decideIdentity(p, { name: 'Priya Sharma', age: '35 Y', sex: 'F' }, '2026-03-15')
    expect(r.result).toBe('match')
    expect(r.notes).toContain('matched_on_alias')
  })
  it('sex mismatch', () => {
    expect(d({ name: 'Sunita Sharma', age: '52', sex: 'M' })).toMatchObject({ result: 'mismatch', reasons: ['sex_mismatch'] })
  })
  it('DOB match, including the MM/DD reading of an ambiguous header DOB', () => {
    expect(d({ name: 'Sunita Sharma', dob: '12/03/1974' }).result).toBe('match')
    const r = d({ name: 'Sunita Sharma', dob: '03/12/1974' })
    expect(r.result).toBe('match')
    expect(r.notes).toContain('dob_ambiguous_reading')
  })
  it('MRN is supportive only', () => {
    expect(d({ name: 'Sunita Sharma', mrn: 'cch 001234' }, null)).toMatchObject({ result: 'match', notes: expect.arrayContaining(['mrn_match']) })
    expect(d({ name: 'Anita Verma', mrn: 'CCH-001234' }).result).toBe('mismatch')
    expect(d({ name: 'Sunita Sharma', mrn: 'XYZ-9', age: '52' }).notes).toContain('mrn_differs')
  })
  it('nothing to corroborate the name → insufficient', () => {
    expect(d({ name: 'Sunita Sharma', sex: 'F' })).toMatchObject({ result: 'insufficient', reasons: ['no_corroborating_field'] })
    expect(d({ name: 'Sunita Sharma', age: '52', sex: 'F' }, null)).toMatchObject({
      result: 'insufficient',
      notes: expect.arrayContaining(['age_not_compared_no_report_date']),
    })
  })
  it('Baby-of header is never matched to the mother', () => {
    expect(d({ name: 'B/O Sunita Sharma', age: '2 D', sex: 'F' }).result).not.toBe('match')
  })
  it('hard conflicts win over a weak name', () => {
    expect(d({ name: 'S. Sharma', age: '30', sex: 'F' })).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch', 'single_name_token'] })
  })
})

// ---------------- labelled set (FR-ID-04: ≥ 200 pairs) ----------------

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FEMALE = ['Sunita', 'Anita', 'Priya', 'Kavita', 'Meena', 'Rekha', 'Pooja', 'Neha', 'Geeta', 'Lakshmi', 'Asha', 'Usha', 'Shobha', 'Nirmala', 'Kamla', 'Radha', 'Seema', 'Anjali', 'Deepa', 'Jyoti', 'Swati', 'Nisha', 'Rubina', 'Farida', 'Shabana', 'Fatima', 'Mary', 'Shalini', 'Bhavna', 'Mamta', 'Archana', 'Vandana', 'Poonam', 'Renu', 'Madhuri']
const MALE = ['Ramesh', 'Suresh', 'Rajesh', 'Mahesh', 'Dinesh', 'Sunil', 'Anil', 'Vijay', 'Sanjay', 'Ajay', 'Rakesh', 'Mukesh', 'Deepak', 'Amit', 'Rahul', 'Vikas', 'Manoj', 'Ashok', 'Prakash', 'Arun', 'Ravi', 'Gopal', 'Krishna', 'Mohan', 'Shankar', 'Harish', 'Rafiq', 'Imran', 'Salim', 'Joseph', 'Thomas', 'Arjun', 'Naveen', 'Pradeep', 'Sandeep', 'Kishore', 'Venkatesh', 'Srinivas', 'Ganesh', 'Yogesh']
const SURNAMES = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Patel', 'Shah', 'Reddy', 'Rao', 'Nair', 'Iyer', 'Pillai', 'Das', 'Ghosh', 'Banerjee', 'Mukherjee', 'Chatterjee', 'Joshi', 'Kulkarni', 'Deshpande', 'Patil', 'Jadhav', 'Yadav', 'Mishra', 'Tiwari', 'Pandey', 'Dubey', 'Chauhan', 'Rathore', 'Agarwal', 'Jain', 'Mehta', 'Khan', 'Ansari', 'Qureshi', 'Siddiqui', 'Shaikh', 'Fernandes', 'Menon', 'Naidu', 'Bose', 'Sinha', 'Thakur']
const DEVANAGARI: Record<string, string> = {
  Sunita: 'सुनीता', Anita: 'अनीता', Priya: 'प्रिया', Kavita: 'कविता', Meena: 'मीना', Lakshmi: 'लक्ष्मी', Asha: 'आशा',
  Fatima: 'फ़ातिमा', Rajesh: 'राजेश', Suresh: 'सुरेश', Vijay: 'विजय', Rafiq: 'रफ़ीक', Ramesh: 'रमेश', Deepak: 'दीपक',
  Sharma: 'शर्मा', Verma: 'वर्मा', Gupta: 'गुप्ता', Yadav: 'यादव', Joshi: 'जोशी', Patel: 'पटेल', Singh: 'सिंह',
  Khan: 'खान', Ansari: 'अंसारी', Mishra: 'मिश्रा', Jain: 'जैन',
}
const VARIANTS: Record<string, string[]> = {
  Sharma: ['Sarma'], Lakshmi: ['Laxmi'], Pooja: ['Puja'], Deepak: ['Dipak'], Sunita: ['Sunitha'], Kavita: ['Kavitha'],
  Geeta: ['Gita'], Sanjay: ['Sanjai'], Ajay: ['Ajai'], Vijay: ['Vijai'], Seema: ['Sima'], Meena: ['Mina'],
  Rafiq: ['Rafique'], Agarwal: ['Aggarwal', 'Agrawal'], Chauhan: ['Chouhan'], Banerjee: ['Banerji'], Mukherjee: ['Mukerji'],
  Chatterjee: ['Chaterji'], Siddiqui: ['Siddiqi'], Qureshi: ['Kureshi'], Joshi: ['Joshee'], Verma: ['Varma'],
  Srinivas: ['Shrinivas'], Krishna: ['Krisna'], Jyoti: ['Jyothi'], Pradeep: ['Pradip'], Sandeep: ['Sandip'],
  Naveen: ['Navin'], Shobha: ['Sobha'], Radha: ['Radhaa'], Mohan: ['Mohun'], Usha: ['Ushaa'],
}
const CONFUSABLE: Record<string, string> = {
  Ramesh: 'Rajesh', Rajesh: 'Rakesh', Rakesh: 'Mukesh', Suresh: 'Naresh', Mahesh: 'Ganesh', Dinesh: 'Yogesh', Sunil: 'Sushil',
  Anil: 'Akhil', Vijay: 'Ajay', Priya: 'Piya', Sunita: 'Sumita', Anita: 'Amita', Kavita: 'Savita', Meena: 'Reena',
  Rekha: 'Lekha', Geeta: 'Neeta', Asha: 'Usha', Pradeep: 'Sandeep', Mohan: 'Sohan', Amit: 'Sumit',
}

interface Pair {
  patient: PatientIdentity
  header: HeaderIdentity
  reportDate: string
  same: boolean
  kind: string
}

function buildLabelledSet(): Pair[] {
  const r = rng(20261102)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const pad = (n: number) => String(n).padStart(2, '0')
  const pairs: Pair[] = []
  const person = () => {
    const sex = r() < 0.5 ? 'F' : 'M'
    const given = pick(sex === 'F' ? FEMALE : MALE)
    const surname = pick(SURNAMES)
    const y = 1940 + Math.floor(r() * 60)
    const dob = `${y}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`
    return { sex, given, surname, dob }
  }
  const reportDate = () => `202${Math.floor(r() * 6)}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`
  const ageFmt = (a: number) => pick([`${a} Y`, `${a} Yrs`, `${a} years`, `${a}`, `${a}Y`, `${a} वर्ष`])
  const sexFmt = (s: string) => (s === 'F' ? pick(['F', 'Female', 'महिला', 'FEMALE']) : pick(['M', 'Male', 'पुरुष', 'MALE']))
  const dobFmt = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return pick([`${d}/${m}/${y}`, `${d}-${m}-${y}`, `${d}.${m}.${y}`])
  }

  // Positives: same person, header written differently.
  const posKinds = ['exact', 'upper', 'honorific', 'devanagari', 'variant', 'relation', 'middle', 'initial_middle', 'alias', 'surname_first', 'dob', 'mrn']
  for (let i = 0; i < 180; i++) {
    const p = person()
    const rd = reportDate()
    const kind = posKinds[i % posKinds.length]
    let headerName = `${p.given} ${p.surname}`
    let patientName = `${p.given} ${p.surname}`
    const aliases: string[] = []
    const header: HeaderIdentity = { age: ageFmt(ageOn(p.dob, rd) + pick([-1, 0, 0, 0, 1])), sex: r() < 0.85 ? sexFmt(p.sex) : null }
    const mrns: string[] = []
    switch (kind) {
      case 'upper':
        headerName = headerName.toUpperCase()
        break
      case 'honorific':
        headerName = `${pick(p.sex === 'F' ? ['Smt.', 'Mrs.', 'Ms', 'Kum.', 'Kumari'] : ['Mr.', 'Shri', 'Sri', 'Mr'])} ${headerName}`
        break
      case 'devanagari':
        headerName = `${DEVANAGARI[p.given] ?? p.given} ${DEVANAGARI[p.surname] ?? p.surname}`
        break
      case 'variant':
        headerName = `${pick(VARIANTS[p.given] ?? [p.given])} ${pick(VARIANTS[p.surname] ?? [p.surname])}`
        break
      case 'relation':
        headerName = `${headerName} ${p.sex === 'F' ? pick(['W/o', 'w/o', 'D/O']) : pick(['S/o', 'S/O'])} ${pick(MALE)} ${p.surname}`
        break
      case 'middle':
        patientName = `${p.given} ${p.sex === 'F' ? 'Devi' : 'Kumar'} ${p.surname}`
        break
      case 'initial_middle':
        patientName = `${p.given} ${p.sex === 'F' ? 'Rani' : 'Prakash'} ${p.surname}`
        headerName = `${p.given} ${p.sex === 'F' ? 'R.' : 'P.'} ${p.surname}`
        break
      case 'alias':
        patientName = `${p.given} ${pick(SURNAMES.filter((s) => s !== p.surname))}`
        aliases.push(`${p.given} ${p.surname}`)
        break
      case 'surname_first':
        headerName = `${p.surname.toUpperCase()}, ${p.given.toUpperCase()}`
        break
      case 'dob':
        delete header.age
        header.dob = dobFmt(p.dob)
        break
      case 'mrn':
        delete header.age
        mrns.push(`UHID-${1000 + i}`)
        header.mrn = `uhid ${1000 + i}`
        break
    }
    header.name = headerName
    pairs.push({ patient: { name: patientName, aliases, dob: p.dob, sex: p.sex, mrns }, header, reportDate: rd, same: true, kind })
  }

  // Negatives: a different person, complete header (name + age + sex).
  const negKinds = ['same_surname', 'same_given', 'age_gap', 'sex', 'different', 'confusable']
  for (let i = 0; i < 180; i++) {
    const p = person()
    const rd = reportDate()
    const kind = negKinds[i % negKinds.length]
    const pool = p.sex === 'F' ? FEMALE : MALE
    let given = p.given
    let surname = p.surname
    let sex = p.sex
    let age = ageOn(p.dob, rd)
    switch (kind) {
      case 'same_surname':
        given = pick(pool.filter((g) => g !== p.given))
        break
      case 'same_given':
        surname = pick(SURNAMES.filter((s) => s !== p.surname))
        break
      case 'age_gap':
        age += pick([-1, 1]) * (2 + Math.floor(r() * 25))
        if (age < 0) age = ageOn(p.dob, rd) + 5
        break
      case 'sex':
        sex = p.sex === 'F' ? 'M' : 'F'
        break
      case 'different':
        given = pick((p.sex === 'F' ? FEMALE : MALE).filter((g) => g !== p.given))
        surname = pick(SURNAMES.filter((s) => s !== p.surname))
        break
      case 'confusable':
        given = CONFUSABLE[p.given] ?? pick(pool.filter((g) => g !== p.given))
        break
    }
    pairs.push({
      patient: { name: `${p.given} ${p.surname}`, dob: p.dob, sex: p.sex },
      header: { name: `${given} ${surname}`, age: ageFmt(age), sex: sexFmt(sex) },
      reportDate: rd,
      same: false,
      kind,
    })
  }
  return pairs
}

describe('decideIdentity: labelled set metrics (FR-ID-04)', () => {
  const pairs = buildLabelledSet()
  const results = pairs.map((p) => ({ ...p, decision: decideIdentity(p.patient, p.header, p.reportDate) }))
  const neg = results.filter((x) => !x.same)
  const pos = results.filter((x) => x.same)
  const mismatchRecall = neg.filter((x) => x.decision.result === 'mismatch').length / neg.length
  const falseMatchRate = neg.filter((x) => x.decision.result === 'match').length / neg.length
  const positiveMatchRate = pos.filter((x) => x.decision.result === 'match').length / pos.length
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`
  const failures = (xs: typeof results, ok: (x: (typeof results)[number]) => boolean) =>
    xs.filter((x) => !ok(x)).map((x) => `${x.kind}: "${x.header.name}" vs "${x.patient.name}" → ${x.decision.result} ${x.decision.reasons.join(',')}`)

  it('has ≥ 200 labelled pairs', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(200)
    expect(neg.length).toBeGreaterThanOrEqual(100)
  })

  it(`mismatch recall ≥ 0.99 (measured ${pct(mismatchRecall)})`, () => {
    expect(mismatchRecall, failures(neg, (x) => x.decision.result === 'mismatch').join('\n')).toBeGreaterThanOrEqual(0.99)
  })

  it(`false-match rate ≤ 0.5% (measured ${pct(falseMatchRate)})`, () => {
    expect(failures(neg, (x) => x.decision.result !== 'match')).toEqual([])
    expect(falseMatchRate).toBeLessThanOrEqual(0.005)
  })

  it(`true variants are matched (measured ${pct(positiveMatchRate)})`, () => {
    // Misses here fall to mismatch/insufficient → a human confirms (safe direction).
    expect(positiveMatchRate, failures(pos, (x) => x.decision.result === 'match').join('\n')).toBeGreaterThanOrEqual(0.95)
  })
})

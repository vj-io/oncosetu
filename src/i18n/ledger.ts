// Public seal-verification page (/verify/[snapshotId]): reachable from share links, so neutral wording only (FR-CON-07).
export const verifyCopy = {
  pageTitle: { en: 'Seal verification', hi: 'मुहर की जाँच' },
  intactLabel: { en: 'intact', hi: 'सुरक्षित' },
  ring: { en: 'Seal verified · SHA-256 · Ed25519 ·', hi: 'Seal verified · SHA-256 · Ed25519 ·' },
  brokenBadge: { en: 'Seal broken', hi: 'मुहर टूटी' },
  sealedLine: { en: 'Snapshot S{seq} · sealed {date}, {time} IST', hi: 'स्नैपशॉट S{seq} · मुहर {date}, {time} IST' },
  intactTitle: { en: 'This record has not changed since it was sealed.', hi: 'मुहर लगने के बाद से यह रिकॉर्ड नहीं बदला है।' },
  brokenTitle: { en: 'This snapshot does not match its seal.', hi: 'यह स्नैपशॉट अपनी मुहर से मेल नहीं खाता।' },
  intactBody: {
    en: 'The stored record was re-hashed just now and matches the SHA-256 recorded at sealing, and the hospital’s Ed25519 signature over it is valid.',
    hi: 'रखे गए रिकॉर्ड का हैश अभी दोबारा निकाला गया: यह मुहर के समय दर्ज SHA-256 से मेल खाता है, और अस्पताल का Ed25519 हस्ताक्षर मान्य है।',
  },
  brokenBody: {
    en: 'The stored bytes no longer produce the recorded hash or signature. Treat this copy as altered and ask the hospital for the original.',
    hi: 'रखा गया रिकॉर्ड अब दर्ज हैश या हस्ताक्षर से मेल नहीं खाता। इस प्रति को बदली हुई मानें और अस्पताल से मूल प्रति माँगें।',
  },
  hash: { en: 'Hash', hi: 'हैश' },
  signature: { en: 'Signature', hi: 'हस्ताक्षर' },
  sealed: { en: 'Sealed', hi: 'मुहर के समय' },
  now: { en: 'Now', hi: 'अभी' },
  key: { en: 'Key', hi: 'कुंजी' },
  contents: { en: 'Contents', hi: 'सामग्री' },
  hashOk: { en: 'Matches the sealed hash', hi: 'मुहर वाले हैश से मेल खाता है' },
  hashBad: { en: 'Does not match', hi: 'मेल नहीं खाता' },
  sigOk: { en: 'Valid Ed25519 signature', hi: 'मान्य Ed25519 हस्ताक्षर' },
  sigBad: { en: 'Invalid or missing', hi: 'अमान्य या अनुपस्थित' },
  publicKeys: { en: 'public keys', hi: 'सार्वजनिक कुंजियाँ' },
  counts: {
    en: '{verified} verified · {unverified} not yet verified · {documents} documents · {missing} listed missing',
    hi: '{verified} जाँचे गए · {unverified} अभी जाँचे नहीं गए · {documents} दस्तावेज़ · {missing} फ़ाइल में नहीं',
  },
  footer: {
    en: 'This page shows no personal information. A list of documents, not a medical summary.',
    hi: 'इस पेज पर कोई व्यक्तिगत जानकारी नहीं है। यह दस्तावेज़ों की सूची है, चिकित्सा सारांश नहीं।',
  },
} as const

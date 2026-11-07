// Patient-facing copy for the Privacy & consent page and the "who can see what" table.
// DRAFT: the notice wording is a working draft, legal review pending. Never claims compliance or certification.
// Linted with every other catalogue (no diagnosis words, no radar words): keep the wording plain.
import type { Lang } from '@/core/types'

type T = { en: string; hi: string; hinglish: string }

export const privacyCopy = {
  navPrivacyPage: { en: 'Privacy & consent', hi: 'गोपनीयता और सहमति', hinglish: 'Privacy aur consent' },
  badge: { en: 'Draft — legal review pending', hi: 'मसौदा — क़ानूनी समीक्षा बाकी', hinglish: 'Draft — legal review baaki hai' },
  kicker: { en: 'Your privacy', hi: 'आपकी गोपनीयता', hinglish: 'Aapki privacy' },
  title: { en: 'Privacy & consent', hi: 'गोपनीयता और सहमति', hinglish: 'Privacy aur consent' },
  intro: {
    en: 'What the clinic keeps, why, and what you decide. You can change your mind at any time.',
    hi: 'क्लिनिक क्या रखता है, क्यों रखता है, और आप क्या तय करते हैं। आप कभी भी अपना फ़ैसला बदल सकते हैं।',
    hinglish: 'Clinic kya rakhta hai, kyun rakhta hai, aur aap kya tay karte hain. Aap kabhi bhi apna faisla badal sakte hain.',
  },
  noticeTitle: { en: 'Privacy notice (Digital Personal Data Protection Act, 2023)', hi: 'गोपनीयता सूचना (डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023)', hinglish: 'Privacy notice (Digital Personal Data Protection Act, 2023)' },
  noticeWhat: {
    en: 'What we keep: the papers you or the clinic send, a list of the facts written in them (each with its source), and a record of who opened your file.',
    hi: 'हम क्या रखते हैं: आप या क्लिनिक जो कागज़ात भेजते हैं, उनमें लिखी बातों की सूची (हर बात के स्रोत के साथ), और यह रिकॉर्ड कि आपकी फ़ाइल किसने खोली।',
    hinglish: 'Hum kya rakhte hain: aap ya clinic jo papers bhejte hain, unmein likhi baaton ki list (har baat ke source ke saath), aur yeh record ki aapki file kisne kholi.',
  },
  noticeWhy: {
    en: 'Why: to keep your records in one place for your care at this hospital. Anything beyond that, such as a second opinion or a team discussion, happens only if you switch it on below.',
    hi: 'क्यों: इस अस्पताल में आपकी देखभाल के लिए आपके रिकॉर्ड एक जगह रखना। इसके अलावा कुछ भी, जैसे दूसरी राय या टीम की चर्चा, तभी होता है जब आप नीचे उसे चालू करें।',
    hinglish: 'Kyun: is hospital mein aapki care ke liye aapke records ek jagah rakhna. Uske alawa kuch bhi, jaise second opinion ya team discussion, tabhi hota hai jab aap neeche use on karein.',
  },
  noticeHow: {
    en: 'How long: while you are a patient here and for the period the hospital must keep medical records. When you withdraw, new use stops.',
    hi: 'कितने समय तक: जब तक आप यहाँ के मरीज़ हैं और उतनी अवधि तक जितनी अस्पताल को चिकित्सा रिकॉर्ड रखना होता है। आपके वापस लेने के बाद नया उपयोग रुक जाता है।',
    hinglish: 'Kitne time tak: jab tak aap yahan ke patient hain aur utne time tak jitna hospital ko medical records rakhne hote hain. Aapke withdraw karne ke baad naya use ruk jaata hai.',
  },
  noticeVersion: { en: 'Notice version {version}', hi: 'सूचना संस्करण {version}', hinglish: 'Notice version {version}' },
  ackLabel: { en: 'I have read this notice.', hi: 'मैंने यह सूचना पढ़ ली है।', hinglish: 'Maine yeh notice padh liya hai.' },
  ackButton: { en: 'Save my acknowledgement', hi: 'मेरी पावती सहेजें', hinglish: 'Meri acknowledgement save karein' },
  ackDone: { en: 'Acknowledged on {date} · notice version {version}', hi: '{date} को पावती दी गई · सूचना संस्करण {version}', hinglish: '{date} ko acknowledge kiya · notice version {version}' },
  ackOld: { en: 'The notice has changed since you last acknowledged it. Please read it again.', hi: 'आपकी पिछली पावती के बाद सूचना बदली है। कृपया इसे फिर से पढ़ें।', hinglish: 'Aapki pichhli acknowledgement ke baad notice badli hai. Please ise dobara padhein.' },
  ackSaved: { en: 'Your acknowledgement is saved.', hi: 'आपकी पावती सहेज ली गई है।', hinglish: 'Aapki acknowledgement save ho gayi hai.' },
  purposesTitle: { en: 'What you agree to', hi: 'आप किसकी सहमति देते हैं', hinglish: 'Aap kis cheez ki consent dete hain' },
  purposesIntro: {
    en: 'Each choice is separate. Turning one off never removes your papers; it only stops that use.',
    hi: 'हर विकल्प अलग है। किसी एक को बंद करने से आपके कागज़ात नहीं हटते; सिर्फ़ वह उपयोग रुकता है।',
    hinglish: 'Har choice alag hai. Kisi ek ko off karne se aapke papers nahi hatte; sirf woh use rukta hai.',
  },
  rightsTitle: { en: 'Your rights', hi: 'आपके अधिकार', hinglish: 'Aapke adhikaar' },
  rightAccess: { en: 'Access: ask to see what is kept about you.', hi: 'पहुँच: जो आपके बारे में रखा गया है उसे देखने का अनुरोध।', hinglish: 'Access: aapke baare mein jo rakha gaya hai use dekhne ki request.' },
  rightCorrect: { en: 'Correction: ask for a wrong detail to be fixed.', hi: 'सुधार: किसी ग़लत जानकारी को ठीक कराने का अनुरोध।', hinglish: 'Correction: kisi galat detail ko theek karwane ki request.' },
  rightErase: { en: 'Erasure: ask for your records to be removed once you have withdrawn permission.', hi: 'मिटाना: अनुमति वापस लेने के बाद अपने रिकॉर्ड हटाने का अनुरोध।', hinglish: 'Erasure: permission withdraw karne ke baad apne records hatane ki request.' },
  rightGrievance: { en: 'Grievance: raise a complaint with the hospital’s grievance officer.', hi: 'शिकायत: अस्पताल के शिकायत अधिकारी के पास शिकायत दर्ज करें।', hinglish: 'Grievance: hospital ke grievance officer ke paas complaint darj karein.' },
  grievanceOfficer: { en: 'Grievance officer: [ ]   Contact: [ ]', hi: 'शिकायत अधिकारी: [ ]   संपर्क: [ ]', hinglish: 'Grievance officer: [ ]   Contact: [ ]' },
  grievanceBlank: { en: 'To be filled in by the hospital before use.', hi: 'उपयोग से पहले अस्पताल द्वारा भरा जाएगा।', hinglish: 'Use se pehle hospital dwara bhara jaayega.' },
  futureTitle: { en: 'Future scope', hi: 'आगे की योजना', hinglish: 'Aage ki plan' },
  futureText: {
    en: 'Aligning with HIPAA for second opinions from outside India. This is not claimed today.',
    hi: 'भारत के बाहर से दूसरी राय के लिए HIPAA के अनुरूप बनाना। आज इसका कोई दावा नहीं किया जाता।',
    hinglish: 'India ke bahar se second opinion ke liye HIPAA ke hisaab se align karna. Aaj iska koi claim nahi hai.',
  },
  idTitle: { en: 'ID check on file', hi: 'फ़ाइल में पहचान जाँच', hinglish: 'File mein ID check' },
  idNone: { en: 'No ID check has been recorded. This is optional.', hi: 'कोई पहचान जाँच दर्ज नहीं है। यह वैकल्पिक है।', hinglish: 'Koi ID check record nahi hai. Yeh optional hai.' },
  idRecorded: { en: '{type} {masked} · checked by {by} on {date}', hi: '{type} {masked} · {by} ने {date} को जाँचा', hinglish: '{type} {masked} · {by} ne {date} ko check kiya' },
  idNote: { en: 'Only the last 4 characters are kept. A full ID number is never stored.', hi: 'सिर्फ़ आख़िरी 4 अक्षर रखे जाते हैं। पूरा पहचान नंबर कभी नहीं रखा जाता।', hinglish: 'Sirf aakhri 4 characters rakhe jaate hain. Poora ID number kabhi store nahi hota.' },

  // ── who can see what ──
  whoKicker: { en: 'Your privacy', hi: 'आपकी गोपनीयता', hinglish: 'Aapki privacy' },
  whoTitle: { en: 'Who can see what', hi: 'कौन क्या देख सकता है', hinglish: 'Kaun kya dekh sakta hai' },
  whoIntro: {
    en: 'A read-only guide to the hospital roles. It is the same rule set the system enforces; it does not change anything.',
    hi: 'अस्पताल की भूमिकाओं की एक सिर्फ़-पढ़ने वाली गाइड। यही नियम सिस्टम लागू करता है; इससे कुछ नहीं बदलता।',
    hinglish: 'Hospital ke roles ki read-only guide. Yahi rules system lagu karta hai; isse kuch nahi badalta.',
  },
  yes: { en: 'Yes', hi: 'हाँ', hinglish: 'Haan' },
  limited: { en: 'Limited', hi: 'सीमित', hinglish: 'Limited' },
  no: { en: 'No', hi: 'नहीं', hinglish: 'Nahi' },
  rolesHeader: { en: 'Role', hi: 'भूमिका', hinglish: 'Role' },
  r_desk: { en: 'Front desk', hi: 'फ्रंट डेस्क', hinglish: 'Front desk' },
  r_records: { en: 'Records staff', hi: 'रिकॉर्ड स्टाफ', hinglish: 'Records staff' },
  r_clinician: { en: 'Doctor', hi: 'डॉक्टर', hinglish: 'Doctor' },
  r_org_admin: { en: 'Administrator', hi: 'प्रशासक', hinglish: 'Administrator' },
  r_auditor: { en: 'Auditor', hi: 'ऑडिटर', hinglish: 'Auditor' },
  r_patient: { en: 'You (patient)', hi: 'आप (मरीज़)', hinglish: 'Aap (patient)' },
  r_caregiver: { en: 'Caregiver you added', hi: 'आपका जोड़ा गया देखभालकर्ता', hinglish: 'Aapka add kiya hua caregiver' },
  r_share_viewer: { en: 'Someone with a share link', hi: 'शेयर लिंक वाला कोई व्यक्ति', hinglish: 'Share link wala koi vyakti' },
  a_facts: { en: 'See the list of documents and facts', hi: 'दस्तावेज़ों और बातों की सूची देखना', hinglish: 'Documents aur facts ki list dekhna' },
  a_original: { en: 'Open the original files', hi: 'मूल फ़ाइलें खोलना', hinglish: 'Original files kholna' },
  a_upload: { en: 'Add documents', hi: 'दस्तावेज़ जोड़ना', hinglish: 'Documents add karna' },
  a_confirm: { en: 'Confirm what was read from a document', hi: 'दस्तावेज़ से पढ़ी बातों की पुष्टि करना', hinglish: 'Document se padhi baaton ko confirm karna' },
  a_seal: { en: 'Seal a signed snapshot', hi: 'हस्ताक्षरित स्नैपशॉट सील करना', hinglish: 'Signed snapshot seal karna' },
  a_share: { en: 'Create share links', hi: 'शेयर लिंक बनाना', hinglish: 'Share links banana' },
  a_consent: { en: 'Change consent', hi: 'सहमति बदलना', hinglish: 'Consent badalna' },
  a_accesslog: { en: 'See who opened the file (audit log)', hi: 'देखना कि फ़ाइल किसने खोली (ऑडिट लॉग)', hinglish: 'Dekhna ki file kisne kholi (audit log)' },
  a_admin: { en: 'Manage staff and settings', hi: 'स्टाफ़ और सेटिंग्स संभालना', hinglish: 'Staff aur settings sambhalna' },
  whoNotesTitle: { en: 'Conditions that always apply', hi: 'शर्तें जो हमेशा लागू होती हैं', hinglish: 'Conditions jo hamesha lagu hoti hain' },
  note1: { en: 'Staff open a file only while you have given permission to keep your papers, or through a logged emergency (break-glass) access.', hi: 'स्टाफ़ फ़ाइल तभी खोलता है जब आपने कागज़ात रखने की अनुमति दी हो, या दर्ज की गई आपात (ब्रेक-ग्लास) पहुँच से।', hinglish: 'Staff file tabhi kholta hai jab aapne papers rakhne ki permission di ho, ya logged emergency (break-glass) access se.' },
  note2: { en: 'The front desk opens a file only after your code or a witnessed check at the visit.', hi: 'फ्रंट डेस्क फ़ाइल तभी खोलता है जब विज़िट पर आपका कोड दिया गया हो या गवाह के सामने जाँच हुई हो।', hinglish: 'Front desk file tabhi kholta hai jab visit par aapka code diya gaya ho ya witnessed check hua ho.' },
  note3: { en: 'Administrators open a file only through break-glass access. Auditors never open patient files; they see the audit log and counts.', hi: 'प्रशासक फ़ाइल सिर्फ़ ब्रेक-ग्लास पहुँच से खोलते हैं। ऑडिटर मरीज़ की फ़ाइल कभी नहीं खोलते; वे ऑडिट लॉग और गिनती देखते हैं।', hinglish: 'Administrators file sirf break-glass access se kholte hain. Auditors patient file kabhi nahi kholte; woh audit log aur counts dekhte hain.' },
  note4: { en: 'A share link shows only what you chose to share, read-only, until it expires or you switch it off.', hi: 'शेयर लिंक सिर्फ़ वही दिखाता है जो आपने साझा करना चुना, सिर्फ़-पढ़ने के लिए, जब तक वह समाप्त न हो या आप उसे बंद न करें।', hinglish: 'Share link sirf wahi dikhata hai jo aapne share karna chuna, read-only, jab tak woh expire na ho ya aap use band na karein.' },
  // ── signing ──
  signTitle: { en: 'Sign the consent form', hi: 'सहमति फ़ॉर्म पर हस्ताक्षर करें', hinglish: 'Consent form par sign karein' },
  signIntro: {
    en: 'Sign to confirm the choices above. You get a signed copy (PDF) that is kept with your documents. You can print it.',
    hi: 'ऊपर के विकल्पों की पुष्टि के लिए हस्ताक्षर करें। आपको हस्ताक्षरित प्रति (PDF) मिलती है जो आपके दस्तावेज़ों के साथ रखी जाती है। आप इसे प्रिंट कर सकते हैं।',
    hinglish: 'Upar ke choices confirm karne ke liye sign karein. Aapko signed copy (PDF) milti hai jo aapke documents ke saath rakhi jaati hai. Aap ise print kar sakte hain.',
  },
  signName: { en: 'Your full name', hi: 'आपका पूरा नाम', hinglish: 'Aapka poora naam' },
  signAs: { en: 'Signing as: {who}', hi: 'हस्ताक्षरकर्ता: {who}', hinglish: 'Sign kar rahe hain: {who}' },
  who_self: { en: 'the patient', hi: 'मरीज़ स्वयं', hinglish: 'patient khud' },
  who_guardian: { en: 'parent or guardian of the patient', hi: 'मरीज़ के माता-पिता या अभिभावक', hinglish: 'patient ke parent ya guardian' },
  who_caregiver: { en: 'caregiver acting for the patient', hi: 'मरीज़ की ओर से देखभालकर्ता', hinglish: 'patient ki taraf se caregiver' },
  signDraw: { en: 'Draw signature', hi: 'हस्ताक्षर बनाएँ', hinglish: 'Signature banayein' },
  signType: { en: 'Type my name', hi: 'मेरा नाम टाइप करें', hinglish: 'Mera naam type karein' },
  signClear: { en: 'Clear', hi: 'मिटाएँ', hinglish: 'Mitayein' },
  signHint: { en: 'Draw with your finger or the mouse inside the box.', hi: 'बॉक्स के अंदर उँगली या माउस से बनाएँ।', hinglish: 'Box ke andar ungli ya mouse se banayein.' },
  signTyped: { en: 'Typing your name counts as your signature.', hi: 'नाम टाइप करना आपका हस्ताक्षर माना जाता है।', hinglish: 'Naam type karna aapka signature maana jaata hai.' },
  signButton: { en: 'Sign and save', hi: 'हस्ताक्षर करें और सहेजें', hinglish: 'Sign karein aur save karein' },
  signWithdrawButton: { en: 'Sign a withdrawal of all consent', hi: 'सारी सहमति वापस लेने पर हस्ताक्षर करें', hinglish: 'Saari consent wapas lene par sign karein' },
  signDone: { en: 'Signed and saved. A copy is kept with your documents.', hi: 'हस्ताक्षर हो गए और सहेज लिए गए। एक प्रति आपके दस्तावेज़ों के साथ रखी गई है।', hinglish: 'Sign ho gaya aur save ho gaya. Ek copy aapke documents ke saath rakhi gayi hai.' },
  signedList: { en: 'Signed forms', hi: 'हस्ताक्षरित फ़ॉर्म', hinglish: 'Signed forms' },
  signedNone: { en: 'Nothing signed yet.', hi: 'अभी कुछ हस्ताक्षरित नहीं है।', hinglish: 'Abhi kuch signed nahi hai.' },
  viewPdf: { en: 'Open or print (PDF)', hi: 'खोलें या प्रिंट करें (PDF)', hinglish: 'Kholein ya print karein (PDF)' },
  signedGrant: { en: 'Consent form', hi: 'सहमति फ़ॉर्म', hinglish: 'Consent form' },
  signedWithdraw: { en: 'Withdrawal of consent', hi: 'सहमति की वापसी', hinglish: 'Consent ki wapsi' },
  signedBy: { en: 'signed by {name} on {date}', hi: '{name} ने {date} को हस्ताक्षर किए', hinglish: '{name} ne {date} ko sign kiya' },
} as const satisfies Record<string, T>

export type PrivacyKey = keyof typeof privacyCopy

export function tv(lang: Lang, key: PrivacyKey, vars?: Record<string, string | number>): string {
  const s = privacyCopy[key][lang]
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : s
}

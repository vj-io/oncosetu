// Patient-facing strings for ABDM record requests (/p/abdm and the request SMS) — FR-CON-07 neutral copy.
// No diagnosis or treatment-class words, no "need / should / urgent", no brand (the SMS takes brandFor(disclosure)).
// Record kinds are named neutrally (scan and test reports, discharge papers, visit notes, prescriptions).
// Placeholders are {name} tokens so every sentence stays a plain string the copy lint (src/core/copy/copy-lint.test.ts) scans.
import type { Lang } from '@/core/types'

export const en = {
  kicker: 'ABHA records',
  title: 'Records from your ABHA account',
  intro: 'Your clinic team can ask to bring in records that other hospitals and labs have linked to your ABHA health account. Nothing is brought in unless you approve it here. You can withdraw your approval at any time, and the records are then removed from your file.',
  none: 'There are no requests right now.',
  askTitle: 'Your clinic team asks to bring in records',
  asksFor: 'Records asked for: {types}',
  dates: 'Dates: {from} to {to}',
  keptUntil: 'If you approve, the records stay in your file until {date} and are then removed.',
  approve: 'Approve',
  deny: 'Decline',
  revoke: 'Withdraw approval and remove these records',
  revokeConfirm: 'The records brought in with this approval will be removed from your file. Do you want to continue?',
  yesRemove: 'Yes, remove them',
  cancel: 'Cancel',
  stateRequested: 'Waiting for your answer',
  stateGranted: 'Approved',
  stateDenied: 'Declined',
  stateRevoked: 'Approval withdrawn, records removed',
  stateExpired: 'Ended, records removed',
  approvedOn: 'Approved on {date}. Documents brought in: {count}. They will be removed on {until}.',
  askedOn: 'Asked on {date}',
  savedApproved: 'Thank you. Your approval is saved.',
  savedDenied: 'Your answer is saved. Nothing was brought in.',
  savedRevoked: 'Approval withdrawn. The records are removed from your file.',
  error: 'Something went wrong. Please try again.',
  typeDiagnosticReport: 'Test and scan reports',
  typeDischargeSummary: 'Hospital discharge papers',
  typeOPConsultation: "Doctor's visit notes",
  typePrescription: 'Prescriptions',
  sms: '{brand}: your clinic team asked to bring in records linked to your ABHA health account. Open {url} to approve or decline. Nothing is brought in without your approval.',
}
export type AbdmKey = keyof typeof en

export const hi: Record<AbdmKey, string> = {
  kicker: 'ABHA रिकॉर्ड',
  title: 'आपके ABHA खाते के रिकॉर्ड',
  intro: 'आपकी क्लिनिक टीम वे रिकॉर्ड मँगवाने के लिए कह सकती है जिन्हें दूसरे अस्पतालों और लैब ने आपके ABHA स्वास्थ्य खाते से जोड़ा है। जब तक आप यहाँ मंज़ूरी नहीं देते, कुछ भी नहीं मँगवाया जाता। आप कभी भी अपनी मंज़ूरी वापस ले सकते हैं, तब वे रिकॉर्ड आपकी फ़ाइल से हटा दिए जाते हैं।',
  none: 'अभी कोई अनुरोध नहीं है।',
  askTitle: 'आपकी क्लिनिक टीम रिकॉर्ड मँगवाने के लिए पूछ रही है',
  asksFor: 'माँगे गए रिकॉर्ड: {types}',
  dates: 'तारीख़ें: {from} से {to} तक',
  keptUntil: 'मंज़ूरी देने पर ये रिकॉर्ड {date} तक आपकी फ़ाइल में रहेंगे, फिर हटा दिए जाएँगे।',
  approve: 'मंज़ूरी दें',
  deny: 'मना करें',
  revoke: 'मंज़ूरी वापस लें और ये रिकॉर्ड हटाएँ',
  revokeConfirm: 'इस मंज़ूरी से आए रिकॉर्ड आपकी फ़ाइल से हटा दिए जाएँगे। क्या आप आगे बढ़ना चाहते हैं?',
  yesRemove: 'हाँ, हटाएँ',
  cancel: 'रद्द करें',
  stateRequested: 'आपके जवाब का इंतज़ार है',
  stateGranted: 'मंज़ूरी दी गई',
  stateDenied: 'मना किया गया',
  stateRevoked: 'मंज़ूरी वापस ली गई, रिकॉर्ड हटाए गए',
  stateExpired: 'समय पूरा हुआ, रिकॉर्ड हटाए गए',
  approvedOn: '{date} को मंज़ूरी दी गई। आए दस्तावेज़: {count}। ये {until} को हटा दिए जाएँगे।',
  askedOn: '{date} को पूछा गया',
  savedApproved: 'धन्यवाद। आपकी मंज़ूरी दर्ज हो गई।',
  savedDenied: 'आपका जवाब दर्ज हो गया। कुछ भी नहीं मँगवाया गया।',
  savedRevoked: 'मंज़ूरी वापस ली गई। रिकॉर्ड आपकी फ़ाइल से हटा दिए गए।',
  error: 'कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।',
  typeDiagnosticReport: 'जाँच और स्कैन रिपोर्ट',
  typeDischargeSummary: 'अस्पताल से छुट्टी के कागज़',
  typeOPConsultation: 'डॉक्टर विज़िट नोट',
  typePrescription: 'पर्चे',
  sms: '{brand}: आपकी क्लिनिक टीम ने आपके ABHA स्वास्थ्य खाते से जुड़े रिकॉर्ड मँगवाने के लिए पूछा है। मंज़ूरी देने या मना करने के लिए {url} खोलें। आपकी मंज़ूरी के बिना कुछ नहीं मँगवाया जाता।',
}

export function ta(lang: Lang, key: AbdmKey, vars?: Record<string, string | number>): string {
  const s = (lang === 'hi' ? hi : en)[key]
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : s
}

/** Neutral names of the requested record kinds, in order, joined for display. */
export const typeList = (lang: Lang, hiTypes: string[]) =>
  hiTypes.map((t) => ta(lang, `type${t}` as AbdmKey)).join(', ')

// Patient-facing WhatsApp intake replies (FR-ING-05). Neutral wording (FR-CON-07): document counts only, never a
// document type; the brand comes from brandFor(disclosure) so non-cleared patients see "Setu Records".
// src/server/inbound/inbound.test.ts renders every template and runs the copy lint over the output.
type Brand = 'OncoSetu' | 'Setu Records'
const files = { en: (n: number) => `${n} file${n === 1 ? '' : 's'}`, hi: (n: number) => `${n} फ़ाइल` }

export const inboundCopy = {
  /** Unknown sender, a number shared by several records, or no code could be sent: nothing is stored. */
  useUploadLink: {
    en: 'Please use the upload link the clinic sent you.',
    hi: 'कृपया क्लिनिक की ओर से भेजा गया अपलोड लिंक इस्तेमाल करें।',
  },
  /** The one-time code, sent as its own message through the outbox. */
  code: {
    en: (brand: Brand, code: string) => `${brand} code: ${code}. Reply with this code within 10 minutes to add the files you sent. Do not share it.`,
    hi: (brand: Brand, code: string) => `${brand} कोड: ${code}। भेजी गई फ़ाइलें जोड़ने के लिए 10 मिनट के भीतर यही कोड जवाब में भेजें। इसे किसी से साझा न करें।`,
  },
  held: {
    en: (brand: Brand, n: number) => `${brand}: we received ${files.en(n)}. We sent you a 6-digit code. Reply with it within 10 minutes to add the files to your records.`,
    hi: (brand: Brand, n: number) => `${brand}: हमें ${files.hi(n)} मिलीं। हमने आपको 6 अंकों का कोड भेजा है। फ़ाइलें आपके रिकॉर्ड में जोड़ने के लिए 10 मिनट के भीतर वह कोड जवाब में भेजें।`,
  },
  heldMore: {
    en: (brand: Brand, n: number) => `${brand}: we received ${files.en(n)} more. Reply with the 6-digit code we sent you to add them.`,
    hi: (brand: Brand, n: number) => `${brand}: हमें ${files.hi(n)} और मिलीं। इन्हें जोड़ने के लिए हमारा भेजा 6 अंकों का कोड जवाब में भेजें।`,
  },
  released: {
    en: (brand: Brand, n: number) => `${brand}: thank you. ${files.en(n)} added to your records. The clinic team will look at them.`,
    hi: (brand: Brand, n: number) => `${brand}: धन्यवाद। ${files.hi(n)} आपके रिकॉर्ड में जोड़ दी गईं। क्लिनिक की टीम इन्हें देखेगी।`,
  },
  wrongCode: {
    en: (left: number) => `That code did not match. ${left} attempt${left === 1 ? '' : 's'} left.`,
    hi: (left: number) => `यह कोड मेल नहीं खाया। ${left} प्रयास बाक़ी।`,
  },
  discarded: {
    en: 'The files were not added. Please use the upload link the clinic sent you.',
    hi: 'फ़ाइलें नहीं जोड़ी गईं। कृपया क्लिनिक की ओर से भेजा गया अपलोड लिंक इस्तेमाल करें।',
  },
  expired: {
    en: 'That code has expired and the files were not added. Send the files again to get a new code.',
    hi: 'यह कोड समाप्त हो गया और फ़ाइलें नहीं जोड़ी गईं। नया कोड पाने के लिए फ़ाइलें फिर से भेजें।',
  },
  nothingWaiting: {
    en: 'To add papers to your records, send them here as photos or PDF files.',
    hi: 'अपने रिकॉर्ड में कागज़ात जोड़ने के लिए उन्हें यहाँ फ़ोटो या PDF फ़ाइल के रूप में भेजें।',
  },
  badFiles: {
    en: 'These files could not be accepted. Send PDF, JPEG, PNG or HEIC files of 4 MB or less.',
    hi: 'ये फ़ाइलें स्वीकार नहीं की जा सकीं। 4 MB या उससे छोटी PDF, JPEG, PNG या HEIC फ़ाइलें भेजें।',
  },
  notAccepted: {
    en: 'These files could not be accepted here. Please ask at the clinic desk.',
    hi: 'ये फ़ाइलें यहाँ स्वीकार नहीं की जा सकीं। कृपया क्लिनिक के डेस्क पर पूछें।',
  },
} as const

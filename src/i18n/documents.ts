// Patient-facing upload outcomes (patient portal / upload link). Neutral wording only (FR-CON-07): no diagnosis or
// treatment words, no promises. Keys match the codes returned by POST /api/p/documents (ingestDocument).
export const documentsCopy = {
  received: { en: 'Received. Our records team will check it before it is added to your file.', hi: 'मिल गया। आपकी फ़ाइल में जोड़ने से पहले हमारी रिकॉर्ड टीम इसे जाँचेगी।' },
  duplicate: { en: 'This file is already in your record. Nothing more to do.', hi: 'यह फ़ाइल पहले से आपके रिकॉर्ड में है। आगे कुछ करने की ज़रूरत नहीं।' },
  nearDuplicate: { en: 'This looks like a file you sent earlier. Our team will compare them.', hi: 'यह पहले भेजी गई फ़ाइल जैसी लगती है। हमारी टीम दोनों को मिलाकर देखेगी।' },
  notAccepted: { en: 'This file could not be accepted. Please send a clear photo or the PDF from the lab or hospital.', hi: 'यह फ़ाइल स्वीकार नहीं हो सकी। कृपया साफ़ फ़ोटो या लैब/अस्पताल की PDF भेजें।' },
  tooLarge: { en: 'This file is larger than 4 MB. Please send a smaller photo or split the PDF.', hi: 'यह फ़ाइल 4 MB से बड़ी है। कृपया छोटी फ़ोटो भेजें या PDF को भागों में बाँटें।' },
  unsupportedType: { en: 'Please send a PDF or a photo (JPEG, PNG, WebP or HEIC).', hi: 'कृपया PDF या फ़ोटो (JPEG, PNG, WebP या HEIC) भेजें।' },
  passwordProtected: { en: 'This PDF is locked with a password. The records desk can open it with you at your next visit.', hi: 'यह PDF पासवर्ड से बंद है। अगली विज़िट पर रिकॉर्ड डेस्क आपके साथ इसे खोल सकती है।' },
  checking: { en: 'Checking the file…', hi: 'फ़ाइल जाँची जा रही है…' },
} as const

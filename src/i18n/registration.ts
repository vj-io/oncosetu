// Patient-facing strings for registration: printed card, pre-visit SMS, break-glass notice.
// FR-CON-07: neutral wording, brand "Setu Records" (the card swaps in the full brand only when disclosure is cleared).
export const registrationCopy = {
  card: {
    heading: { en: 'Records card', hi: 'रिकॉर्ड कार्ड', hinglish: 'Records card' },
    identifies: {
      en: 'This card identifies you. It does not open your records. A code sent to your phone is also asked for.',
      hi: 'यह कार्ड केवल आपकी पहचान बताता है। यह आपके रिकॉर्ड नहीं खोलता। इसके साथ आपके फ़ोन पर भेजा गया कोड भी पूछा जाता है।',
      hinglish: 'Yeh card aapki pehchaan batata hai. Yeh records nahi kholta. Phone par aaya code bhi poocha jaata hai.',
    },
    lost: {
      en: 'If you lose this card, tell the desk. The old card will stop working.',
      hi: 'यह कार्ड खो जाए तो डेस्क को बताइए। पुराना कार्ड काम करना बंद कर देगा।',
      hinglish: 'Yeh card kho jaaye to desk ko batayein. Purana card kaam nahi karega.',
    },
    code: { en: 'Card code', hi: 'कार्ड कोड', hinglish: 'Card code' },
  },
  preVisitSms: {
    en: (url: string) => `Setu Records: open this link to share your papers before your visit: ${url} A code will be sent to this number.`,
    hi: (url: string) => `Setu Records: अपनी मुलाक़ात से पहले अपने कागज़ात साझा करने के लिए यह लिंक खोलिए: ${url} इसी नंबर पर एक कोड भेजा जाएगा।`,
    hinglish: (url: string) => `Setu Records: visit se pehle kaagazaat share karne ke liye yeh link kholein: ${url} Isi number par code aayega.`,
  },
  breakGlassSms: {
    en: 'Setu Records: a member of your care team opened your file under the hospital emergency access rule. If you have questions, please ask at the hospital desk.',
    hi: 'Setu Records: आपकी देखभाल टीम के एक सदस्य ने अस्पताल के आपातकालीन पहुँच नियम के तहत आपकी फ़ाइल खोली। कोई सवाल हो तो कृपया अस्पताल के डेस्क पर पूछिए।',
    hinglish: 'Setu Records: aapki care team ke ek member ne hospital ke emergency access rule se aapki file kholi. Koi sawaal ho to hospital desk par poochhein.',
  },
  // Sent to the patient's OWN phone when someone gains access or the contact changes, so a change they did not make is noticed.
  caregiverAddedSms: {
    en: 'A family member was added to your Setu Records account. If this was not you, tell the clinic.',
    hi: 'आपके Setu Records खाते में परिवार का एक सदस्य जोड़ा गया। अगर यह आपने नहीं किया, तो क्लिनिक को बताइए।',
    hinglish: 'Setu Records account mein ek family member joda gaya. Aapne nahi kiya to clinic ko batayein.',
  },
  primaryContactSms: {
    en: 'The main contact for your Setu Records account was changed. If this was not you, tell the clinic.',
    hi: 'आपके Setu Records खाते का मुख्य संपर्क बदला गया। अगर यह आपने नहीं किया, तो क्लिनिक को बताइए।',
    hinglish: 'Aapke Setu Records account ka main contact badla gaya. Aapne nahi kiya to clinic ko batayein.',
  },
} as const

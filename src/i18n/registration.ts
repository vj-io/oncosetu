// Patient-facing strings for registration: printed card, pre-visit SMS, break-glass notice.
// FR-CON-07: neutral wording, brand "Setu Records" (the card swaps in the full brand only when disclosure is cleared).
export const registrationCopy = {
  card: {
    heading: { en: 'Records card', hi: 'रिकॉर्ड कार्ड' },
    identifies: {
      en: 'This card identifies you. It does not open your records. A code sent to your phone is also asked for.',
      hi: 'यह कार्ड केवल आपकी पहचान बताता है। यह आपके रिकॉर्ड नहीं खोलता। इसके साथ आपके फ़ोन पर भेजा गया कोड भी पूछा जाता है।',
    },
    lost: {
      en: 'If you lose this card, tell the desk. The old card will stop working.',
      hi: 'यह कार्ड खो जाए तो डेस्क को बताइए। पुराना कार्ड काम करना बंद कर देगा।',
    },
    code: { en: 'Card code', hi: 'कार्ड कोड' },
  },
  preVisitSms: {
    en: (url: string) => `Setu Records: open this link to share your papers before your visit: ${url} A code will be sent to this number.`,
    hi: (url: string) => `Setu Records: अपनी मुलाक़ात से पहले अपने कागज़ात साझा करने के लिए यह लिंक खोलिए: ${url} इसी नंबर पर एक कोड भेजा जाएगा।`,
  },
  breakGlassSms: {
    en: 'Setu Records: a member of your care team opened your file under the hospital emergency access rule. If you have questions, please ask at the hospital desk.',
    hi: 'Setu Records: आपकी देखभाल टीम के एक सदस्य ने अस्पताल के आपातकालीन पहुँच नियम के तहत आपकी फ़ाइल खोली। कोई सवाल हो तो कृपया अस्पताल के डेस्क पर पूछिए।',
  },
} as const

// Patient-facing auth strings (FR-CON-07: neutral brand "Setu Records", no clinical words).
export const authCopy = {
  otpSms: {
    en: (code: string) => `Your Setu Records code is ${code}. Valid 5 minutes.`,
    hi: (code: string) => `आपका Setu Records कोड ${code} है। 5 मिनट तक मान्य।`,
    hinglish: (code: string) => `Aapka Setu Records code: ${code}. 5 minute valid.`,
  },
  otpInvalid: { en: 'That code is not valid or has expired.', hi: 'यह कोड सही नहीं है या समाप्त हो गया है।', hinglish: 'Yeh code sahi nahi hai ya expire ho gaya hai.' },
} as const

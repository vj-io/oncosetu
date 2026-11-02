// Consent notice (FR-CON-01, FR-CON-06, E-CON-01). Patient-facing, versioned: a consent row stores the version it was given under.
// Neutral wording only (FR-CON-07): shown to patients and caregivers whatever the disclosure status.
// When the text changes, add consent-notice.v2 and keep v1 readable: old consent rows point at it.
export const CONSENT_NOTICE_VERSION = 'consent-notice.v2' // v2: ABDM pull is live (asks for approval each time)

export const consentCopy = {
  title: { en: 'Your records and your choices', hi: 'आपके रिकॉर्ड और आपकी पसंद' },
  intro: {
    en: 'Setu Records helps your care team keep your medical papers together in one place. Please read each choice below. You can say yes to some and no to others, and you can change your mind at any time.',
    hi: 'Setu Records आपकी चिकित्सा से जुड़े कागज़ात एक जगह सँभालने में आपकी देखभाल टीम की मदद करता है। कृपया नीचे हर विकल्प पढ़ें। आप कुछ के लिए हाँ और कुछ के लिए ना कह सकते हैं, और कभी भी अपना मन बदल सकते हैं।',
  },
  tagRequired: { en: 'Required to continue', hi: 'आगे बढ़ने के लिए अनिवार्य' },
  tagOptional: { en: 'Your choice', hi: 'आपकी पसंद' },
  tagNotYet: { en: 'Not available yet', hi: 'अभी उपलब्ध नहीं' },
  yes: { en: 'Yes', hi: 'हाँ' },
  no: { en: 'No', hi: 'ना' },
  store: {
    label: { en: 'Keep and organise my records', hi: 'मेरे रिकॉर्ड रखना और व्यवस्थित करना' },
    detail: {
      en: 'We keep the papers and photos you give us in a protected, encrypted form and list them in order of date. Without this we cannot keep a record for you.',
      hi: 'आप जो कागज़ और फ़ोटो हमें देते हैं, उन्हें हम सुरक्षित (एन्क्रिप्टेड) रूप में रखते हैं और तारीख़ के क्रम में सूची बनाते हैं। इसके बिना हम आपका रिकॉर्ड नहीं रख सकते।',
    },
  },
  ai: {
    label: { en: 'Read my papers with computer (AI) services', hi: 'कंप्यूटर (AI) सेवाओं से मेरे कागज़ात पढ़वाना' },
    detail: {
      en: 'Computer programmes (AI) can read the writing on your papers to speed up filing. A computer service run by a company outside India may be used for this, and the text of your papers may be sent to it. If you say no, nothing is sent anywhere and our staff type in the key facts by hand.',
      hi: 'कंप्यूटर प्रोग्राम (AI) आपके कागज़ों पर लिखा पढ़कर फ़ाइल बनाने का काम तेज़ कर सकते हैं। इसके लिए भारत के बाहर की किसी कंपनी की कंप्यूटर सेवा का उपयोग हो सकता है, और आपके कागज़ों का पाठ उसे भेजा जा सकता है। यदि आप ना कहते हैं, तो कुछ भी कहीं नहीं भेजा जाता और हमारे कर्मचारी मुख्य जानकारी हाथ से दर्ज करते हैं।',
    },
  },
  share: {
    label: { en: 'Share with an organisation I name', hi: 'मेरे बताए संगठन के साथ साझा करना' },
    detail: {
      en: 'When you ask us to, we can send a summary to a hospital or doctor you name. Each share is only for the organisation you choose, for the time you choose, and you can stop it at any time.',
      hi: 'जब आप कहेंगे, तब हम आपके बताए अस्पताल या डॉक्टर को सारांश भेज सकते हैं। हर साझा केवल आपके चुने संगठन के लिए और आपके चुने समय तक होता है, और आप उसे कभी भी रोक सकते हैं।',
    },
  },
  abdm: {
    label: { en: 'Fetch records through ABDM', hi: 'ABDM के ज़रिए रिकॉर्ड मँगवाना' },
    detail: {
      en: 'With your approval each time, the clinic may fetch records linked to your ABHA number from the Ayushman Bharat Digital Mission network. You see every request on your phone and can approve, refuse or later revoke it; revoking removes what was fetched.',
      hi: 'हर बार आपकी मंज़ूरी से, क्लिनिक आपके ABHA नंबर से जुड़े रिकॉर्ड आयुष्मान भारत डिजिटल मिशन के नेटवर्क से मँगवा सकता है। हर अनुरोध आपके फ़ोन पर दिखेगा; आप उसे मंज़ूर, अस्वीकार या बाद में वापस ले सकते हैं। वापस लेने पर मँगवाए गए रिकॉर्ड हटा दिए जाते हैं।',
    },
  },
  metrics: {
    label: { en: 'Anonymous counts to improve the service', hi: 'सेवा सुधारने के लिए बिना नाम की गिनती' },
    detail: {
      en: 'Without your name or contact details, we may count how our service is working, for example how many papers are missing at a first visit. These counts help the hospital improve.',
      hi: 'आपके नाम या संपर्क के बिना, हम यह गिन सकते हैं कि हमारी सेवा कैसे काम कर रही है, जैसे पहली मुलाक़ात पर कितने कागज़ात मौजूद नहीं होते। इन गिनतियों से अस्पताल सेवा सुधारता है।',
    },
  },
  withdraw: {
    en: 'You can withdraw this consent at any time. After you withdraw, our staff cannot open your record and every share link stops working.',
    hi: 'आप किसी भी समय यह सहमति वापस ले सकते हैं। वापस लेने के बाद हमारे कर्मचारी आपका रिकॉर्ड नहीं खोल सकेंगे और सभी साझा लिंक काम करना बंद कर देंगे।',
  },
  acknowledgement: {
    en: 'I have heard or read this notice in a language I understand, and my choices above are my own.',
    hi: 'मैंने यह सूचना अपनी समझ की भाषा में सुनी या पढ़ी है, और ऊपर की पसंद मेरी अपनी है।',
  },
} as const

export type ConsentPurposeKey = 'store' | 'ai' | 'share' | 'abdm' | 'metrics'

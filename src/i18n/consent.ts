// Consent notice (FR-CON-01, FR-CON-06, E-CON-01). Patient-facing, versioned: a consent row stores the version it was given under.
// Neutral wording only (FR-CON-07): shown to patients and caregivers whatever the disclosure status.
// When the text changes, add consent-notice.v2 and keep v1 readable: old consent rows point at it.
// Marathi (mr) is the regional language for FR-CON-01: it exists for this notice only (ConsentLang), not across the app.
// MACHINE-DRAFTED: the Marathi, like the Hindi, awaits review by a native speaker before any pilot.
import type { Lang } from '@/core/types'

export const CONSENT_NOTICE_VERSION = 'consent-notice.v2' // v2: ABDM pull is live (asks for approval each time)

export type ConsentLang = Lang | 'mr'
export const CONSENT_LANGS: readonly ConsentLang[] = ['en', 'hi', 'hinglish', 'mr']

export const consentCopy = {
  title: { en: 'Your records and your choices', hi: 'आपके रिकॉर्ड और आपकी पसंद', hinglish: 'Aapke records aur aapki pasand', mr: 'तुमच्या नोंदी आणि तुमच्या निवडी' },
  intro: {
    en: 'Setu Records helps your care team keep your medical papers together in one place. Please read each choice below. You can say yes to some and no to others, and you can change your mind at any time.',
    hi: 'Setu Records आपकी चिकित्सा से जुड़े कागज़ात एक जगह सँभालने में आपकी देखभाल टीम की मदद करता है। कृपया नीचे हर विकल्प पढ़ें। आप कुछ के लिए हाँ और कुछ के लिए ना कह सकते हैं, और कभी भी अपना मन बदल सकते हैं।',
    hinglish: 'Setu Records aapki care team ko aapke medical kaagazaat ek jagah sambhalne mein madad karta hai. Kripya neeche har option padhein. Aap kuch ke liye haan aur kuch ke liye nahi keh sakte hain, aur kabhi bhi apna mann badal sakte hain.',
    mr: 'Setu Records तुमची वैद्यकीय कागदपत्रे एका ठिकाणी सांभाळण्यासाठी तुमच्या उपचार टीमला मदत करते. कृपया खालील प्रत्येक पर्याय वाचा. तुम्ही काहींना होय आणि काहींना नाही म्हणू शकता, आणि कधीही तुमचा विचार बदलू शकता.',
  },
  tagRequired: { en: 'Required to continue', hi: 'आगे बढ़ने के लिए अनिवार्य', hinglish: 'Aage badhne ke liye anivarya', mr: 'पुढे जाण्यासाठी अनिवार्य' },
  tagOptional: { en: 'Your choice', hi: 'आपकी पसंद', hinglish: 'Aapki pasand', mr: 'तुमची निवड' },
  tagNotYet: { en: 'Not available yet', hi: 'अभी उपलब्ध नहीं', hinglish: 'Abhi available nahi', mr: 'अद्याप उपलब्ध नाही' },
  yes: { en: 'Yes', hi: 'हाँ', hinglish: 'Haan', mr: 'होय' },
  no: { en: 'No', hi: 'ना', hinglish: 'Nahi', mr: 'नाही' },
  store: {
    label: { en: 'Keep and organise my records', hi: 'मेरे रिकॉर्ड रखना और व्यवस्थित करना', hinglish: 'Mere records rakhna aur organise karna', mr: 'माझ्या नोंदी ठेवणे आणि व्यवस्थित लावणे' },
    detail: {
      en: 'We keep the papers and photos you give us in a protected, encrypted form and list them in order of date. Without this we cannot keep a record for you.',
      hi: 'आप जो कागज़ और फ़ोटो हमें देते हैं, उन्हें हम सुरक्षित (एन्क्रिप्टेड) रूप में रखते हैं और तारीख़ के क्रम में सूची बनाते हैं। इसके बिना हम आपका रिकॉर्ड नहीं रख सकते।',
      hinglish: 'Aap jo kaagaz aur photo humein dete hain, unhe hum safe, encrypted form mein rakhte hain aur tareekh ke hisaab se list banate hain. Iske bina hum aapka record nahi rakh sakte.',
      mr: 'तुम्ही आम्हाला दिलेली कागदपत्रे आणि फोटो आम्ही सुरक्षित (एन्क्रिप्टेड) स्वरूपात ठेवतो आणि तारखेनुसार त्यांची यादी करतो. याशिवाय आम्ही तुमची नोंद ठेवू शकत नाही.',
    },
  },
  ai: {
    label: { en: 'Read my papers with computer (AI) services', hi: 'कंप्यूटर (AI) सेवाओं से मेरे कागज़ात पढ़वाना', hinglish: 'Computer (AI) services se mere kaagazaat padhwana', mr: 'संगणक (AI) सेवांकडून माझी कागदपत्रे वाचून घेणे' },
    detail: {
      en: 'Computer programmes (AI) can read the writing on your papers to speed up filing. A computer service run by a company outside India may be used for this, and the text of your papers may be sent to it. If you say no, nothing is sent anywhere and our staff type in the key facts by hand.',
      hi: 'कंप्यूटर प्रोग्राम (AI) आपके कागज़ों पर लिखा पढ़कर फ़ाइल बनाने का काम तेज़ कर सकते हैं। इसके लिए भारत के बाहर की किसी कंपनी की कंप्यूटर सेवा का उपयोग हो सकता है, और आपके कागज़ों का पाठ उसे भेजा जा सकता है। यदि आप ना कहते हैं, तो कुछ भी कहीं नहीं भेजा जाता और हमारे कर्मचारी मुख्य जानकारी हाथ से दर्ज करते हैं।',
      hinglish: 'Computer programme (AI) aapke kaagazaat par likha padhkar filing tez kar sakte hain. Iske liye India ke bahar ki kisi company ki computer service use ho sakti hai, aur aapke kaagazaat ka text us service ko bheja ja sakta hai. Aap nahi kehte hain to kuch bhi kahin nahi bheja jaata aur hamara staff mukhya jaankari haath se type karta hai.',
      mr: 'संगणक प्रोग्राम (AI) तुमच्या कागदपत्रांवरील मजकूर वाचून फाइलिंगचे काम जलद करू शकतात. यासाठी भारताबाहेरील एखाद्या कंपनीची संगणक सेवा वापरली जाऊ शकते, आणि तुमच्या कागदपत्रांचा मजकूर त्या सेवेला पाठवला जाऊ शकतो. तुम्ही नाही म्हटल्यास काहीही कुठेही पाठवले जात नाही आणि आमचे कर्मचारी मुख्य माहिती हाताने नोंदवतात.',
    },
  },
  share: {
    label: { en: 'Share with an organisation I name', hi: 'मेरे बताए संगठन के साथ साझा करना', hinglish: 'Mere bataye organisation ke saath share karna', mr: 'मी सांगितलेल्या संस्थेसोबत शेअर करणे' },
    detail: {
      en: 'When you ask us to, we can send a summary to a hospital or doctor you name. Each share is only for the organisation you choose, for the time you choose, and you can stop it at any time.',
      hi: 'जब आप कहेंगे, तब हम आपके बताए अस्पताल या डॉक्टर को सारांश भेज सकते हैं। हर साझा केवल आपके चुने संगठन के लिए और आपके चुने समय तक होता है, और आप उसे कभी भी रोक सकते हैं।',
      hinglish: 'Jab aap kahenge, tab hum aapke bataye hospital ya doctor ko summary bhej sakte hain. Har share sirf aapke chune organisation ke liye aur aapke chune samay tak hota hai, aur aap ise kabhi bhi rok sakte hain.',
      mr: 'तुम्ही सांगाल तेव्हा, तुम्ही नाव दिलेल्या रुग्णालयाला किंवा डॉक्टरांना आम्ही सारांश पाठवू शकतो. प्रत्येक शेअर फक्त तुम्ही निवडलेल्या संस्थेसाठी आणि तुम्ही निवडलेल्या कालावधीपर्यंत असतो, आणि तुम्ही तो कधीही थांबवू शकता.',
    },
  },
  abdm: {
    label: { en: 'Fetch records through ABDM', hi: 'ABDM के ज़रिए रिकॉर्ड मँगवाना', hinglish: 'ABDM ke zariye records mangwana', mr: 'ABDM मार्फत नोंदी मागवणे' },
    detail: {
      en: 'With your approval each time, the clinic may fetch records linked to your ABHA number from the Ayushman Bharat Digital Mission network. You see every request on your phone and can approve, refuse or later revoke it; revoking removes what was fetched.',
      hi: 'हर बार आपकी मंज़ूरी से, क्लिनिक आपके ABHA नंबर से जुड़े रिकॉर्ड आयुष्मान भारत डिजिटल मिशन के नेटवर्क से मँगवा सकता है। हर अनुरोध आपके फ़ोन पर दिखेगा; आप उसे मंज़ूर, अस्वीकार या बाद में वापस ले सकते हैं। वापस लेने पर मँगवाए गए रिकॉर्ड हटा दिए जाते हैं।',
      hinglish: 'Har baar aapki manzoori se, clinic aapke ABHA number se jude records Ayushman Bharat Digital Mission network se mangwa sakta hai. Har request aapke phone par dikhegi aur aap ise manzoor ya mana kar sakte hain, ya baad mein wapas le sakte hain; wapas lene par mangwaye gaye records hata diye jaate hain.',
      mr: 'प्रत्येक वेळी तुमच्या मंजुरीने, क्लिनिक तुमच्या ABHA क्रमांकाशी जोडलेल्या नोंदी आयुष्मान भारत डिजिटल मिशनच्या नेटवर्कवरून मागवू शकते. प्रत्येक विनंती तुमच्या फोनवर दिसेल; तुम्ही ती मंजूर करू शकता, नाकारू शकता किंवा नंतर मागे घेऊ शकता. मागे घेतल्यास मागवलेल्या नोंदी काढून टाकल्या जातात.',
    },
  },
  metrics: {
    label: { en: 'Anonymous counts to improve the service', hi: 'सेवा सुधारने के लिए बिना नाम की गिनती', hinglish: 'Service behtar karne ke liye bina naam ki ginti', mr: 'सेवा सुधारण्यासाठी नाव नसलेली मोजणी' },
    detail: {
      en: 'Without your name or contact details, we may count how our service is working, for example how many papers are missing at a first visit. These counts help the hospital improve.',
      hi: 'आपके नाम या संपर्क के बिना, हम यह गिन सकते हैं कि हमारी सेवा कैसे काम कर रही है, जैसे पहली मुलाक़ात पर कितने कागज़ात मौजूद नहीं होते। इन गिनतियों से अस्पताल सेवा सुधारता है।',
      hinglish: 'Aapke naam ya contact details ke bina, hum gin sakte hain ki hamari service kaise kaam kar rahi hai, jaise pehli visit par kitne kaagazaat missing hote hain. Yeh ginti hospital ko behtar hone mein madad karti hai.',
      mr: 'तुमचे नाव किंवा संपर्क तपशील न वापरता, आमची सेवा कशी काम करत आहे हे आम्ही मोजू शकतो, उदाहरणार्थ पहिल्या भेटीत किती कागदपत्रे उपलब्ध नसतात. या मोजणीमुळे रुग्णालयाला सेवा सुधारण्यास मदत होते.',
    },
  },
  withdraw: {
    en: 'You can withdraw this consent at any time. After you withdraw, our staff cannot open your record and every share link stops working.',
    hi: 'आप किसी भी समय यह सहमति वापस ले सकते हैं। वापस लेने के बाद हमारे कर्मचारी आपका रिकॉर्ड नहीं खोल सकेंगे और सभी साझा लिंक काम करना बंद कर देंगे।',
    hinglish: 'Aap kabhi bhi yeh consent wapas le sakte hain. Wapas lene ke baad hamara staff aapka record nahi khol sakega aur har share link kaam karna band kar dega.',
    mr: 'तुम्ही ही संमती कधीही मागे घेऊ शकता. मागे घेतल्यानंतर आमचे कर्मचारी तुमची नोंद उघडू शकणार नाहीत आणि सर्व शेअर लिंक काम करणे बंद करतील.',
  },
  acknowledgement: {
    en: 'I have heard or read this notice in a language I understand, and my choices above are my own.',
    hi: 'मैंने यह सूचना अपनी समझ की भाषा में सुनी या पढ़ी है, और ऊपर की पसंद मेरी अपनी है।',
    hinglish: 'Maine yeh notice apni samajh ki bhasha mein suna ya padha hai, aur upar ki pasand meri apni hai.',
    mr: 'मी ही सूचना मला समजणाऱ्या भाषेत ऐकली किंवा वाचली आहे, आणि वरील निवडी माझ्या स्वतःच्या आहेत.',
  },
} as const

export type ConsentPurposeKey = 'store' | 'ai' | 'share' | 'abdm' | 'metrics'

// Copy for the demo sign-in panel on /p/login (shown only in demo mode). Synthetic people only.
import type { Lang } from '@/core/types'

type T = { en: string; hi: string; hinglish: string }

export const demoCopy = {
  title: { en: 'Demo accounts · synthetic patients', hi: 'डेमो खाते · काल्पनिक मरीज़', hinglish: 'Demo accounts · synthetic patients' },
  hint: { en: 'Choose a person to fill in the phone number and the code. You still press Sign in.', hi: 'किसी व्यक्ति को चुनें, फ़ोन नंबर और कोड भर जाएगा। साइन इन आपको ही दबाना है।', hinglish: 'Kisi person ko chunein, phone number aur code bhar jaayega. Sign in aapko hi dabana hai.' },
  rohan: { en: 'Rohan Deshmukh: son and main contact of Sunita (opens in Hindi)', hi: 'रोहन देशमुख: सुनीता के बेटे और मुख्य संपर्क (हिंदी में खुलता है)', hinglish: 'Rohan Deshmukh: Sunita ke bete aur main contact (Hindi mein khulta hai)' },
  khan: { en: 'Mohd. Abdul Rahim Khan: returning patient (English)', hi: 'मोहद. अब्दुल रहीम ख़ान: दोबारा आए मरीज़ (अंग्रेज़ी)', hinglish: 'Mohd. Abdul Rahim Khan: dobara aaye patient (English)' },
  narayanan: { en: 'K. Narayanan: husband of Lakshmi, request fulfilled', hi: 'के. नारायणन: लक्ष्मी के पति, अनुरोध पूरा हुआ', hinglish: 'K. Narayanan: Lakshmi ke pati, request poori hui' },
  pooja: { en: 'Pooja Kulkarni: mother and guardian of Aarav, 12', hi: 'पूजा कुलकर्णी: आरव (12) की माँ और अभिभावक', hinglish: 'Pooja Kulkarni: Aarav (12) ki maa aur guardian' },
  working: { en: 'Sending the code…', hi: 'कोड भेजा जा रहा है…', hinglish: 'Code bhej rahe hain…' },
  filled: { en: 'The code is filled in. Press Sign in.', hi: 'कोड भर दिया गया है। साइन इन दबाएँ।', hinglish: 'Code bhar diya gaya hai. Sign in dabayein.' },
  failed: { en: 'The demo code could not be made. Try again.', hi: 'डेमो कोड नहीं बन सका। फिर कोशिश करें।', hinglish: 'Demo code nahi ban saka. Phir koshish karein.' },
  tooMany: { en: 'Too many demo sign-ins from this network. Try again in a few minutes.', hi: 'इस नेटवर्क से बहुत सारे डेमो साइन इन हुए। कुछ मिनट बाद कोशिश करें।', hinglish: 'Is network se bahut saare demo sign-in hue. Kuch minute baad koshish karein.' },
} as const satisfies Record<string, T>

export type DemoKey = keyof typeof demoCopy
export const dm = (lang: Lang, key: DemoKey): string => demoCopy[key][lang]

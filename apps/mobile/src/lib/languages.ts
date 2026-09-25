export const LANGUAGES: Record<string, string> = {
  ar: 'Arabic',
  bn: 'Bengali',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fa: 'Persian',
  fil: 'Filipino',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  km: 'Khmer',
  ko: 'Korean',
  lo: 'Lao',
  ms: 'Malay',
  my: 'Burmese',
  ne: 'Nepali',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  si: 'Sinhala',
  sv: 'Swedish',
  sw: 'Swahili',
  ta: 'Tamil',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

const BY_COUNTRY: Record<string, string> = {
  AE: 'ar', AR: 'es', AT: 'de', BD: 'bn', BR: 'pt', CH: 'de', CL: 'es', CN: 'zh', CO: 'es',
  DE: 'de', EG: 'ar', ES: 'es', FR: 'fr', GR: 'el', HK: 'zh', ID: 'id', IL: 'he', IN: 'hi',
  IR: 'fa', IT: 'it', JP: 'ja', KE: 'sw', KH: 'km', KR: 'ko', LA: 'lo', LK: 'si', MA: 'ar',
  MM: 'my', MX: 'es', MY: 'ms', NL: 'nl', NP: 'ne', PE: 'es', PH: 'fil', PK: 'ur', PL: 'pl',
  PT: 'pt', RU: 'ru', SA: 'ar', SE: 'sv', SG: 'en', TH: 'th', TR: 'tr', TW: 'zh', TZ: 'sw',
  UA: 'uk', VN: 'vi',
};

export function countryLanguage(country: string | null | undefined): string | undefined {
  return country ? BY_COUNTRY[country.toUpperCase()] : undefined;
}

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code.toUpperCase();
}

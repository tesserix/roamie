// Hand-compiled 2026-09 from national emergency-service listings; each row must be re-checked against its official source before a store release.
export type Numbers = {
  name: string;
  police: string;
  ambulance: string;
  fire: string;
  tourist?: string;
};

export const EMERGENCY: Record<string, Numbers> = {
  AE: { name: 'United Arab Emirates', police: '999', ambulance: '998', fire: '997' },
  AR: { name: 'Argentina', police: '911', ambulance: '107', fire: '100' },
  AT: { name: 'Austria', police: '133', ambulance: '144', fire: '122' },
  AU: { name: 'Australia', police: '000', ambulance: '000', fire: '000' },
  BE: { name: 'Belgium', police: '101', ambulance: '112', fire: '112' },
  BR: { name: 'Brazil', police: '190', ambulance: '192', fire: '193' },
  CA: { name: 'Canada', police: '911', ambulance: '911', fire: '911' },
  CH: { name: 'Switzerland', police: '117', ambulance: '144', fire: '118' },
  CN: { name: 'China', police: '110', ambulance: '120', fire: '119' },
  DE: { name: 'Germany', police: '110', ambulance: '112', fire: '112' },
  DK: { name: 'Denmark', police: '112', ambulance: '112', fire: '112' },
  EG: { name: 'Egypt', police: '122', ambulance: '123', fire: '180', tourist: '126' },
  ES: { name: 'Spain', police: '112', ambulance: '112', fire: '112' },
  FI: { name: 'Finland', police: '112', ambulance: '112', fire: '112' },
  FR: { name: 'France', police: '17', ambulance: '15', fire: '18' },
  GB: { name: 'United Kingdom', police: '999', ambulance: '999', fire: '999' },
  GR: { name: 'Greece', police: '100', ambulance: '166', fire: '199', tourist: '1571' },
  HK: { name: 'Hong Kong', police: '999', ambulance: '999', fire: '999' },
  ID: { name: 'Indonesia', police: '110', ambulance: '118', fire: '113' },
  IE: { name: 'Ireland', police: '112', ambulance: '112', fire: '112' },
  IN: { name: 'India', police: '112', ambulance: '108', fire: '101' },
  IT: { name: 'Italy', police: '112', ambulance: '118', fire: '115' },
  JP: { name: 'Japan', police: '110', ambulance: '119', fire: '119' },
  KH: { name: 'Cambodia', police: '117', ambulance: '119', fire: '118' },
  KR: { name: 'South Korea', police: '112', ambulance: '119', fire: '119', tourist: '1330' },
  LK: { name: 'Sri Lanka', police: '119', ambulance: '1990', fire: '110' },
  MX: { name: 'Mexico', police: '911', ambulance: '911', fire: '911' },
  MY: { name: 'Malaysia', police: '999', ambulance: '999', fire: '994' },
  NL: { name: 'Netherlands', police: '112', ambulance: '112', fire: '112' },
  NO: { name: 'Norway', police: '112', ambulance: '113', fire: '110' },
  NP: { name: 'Nepal', police: '100', ambulance: '102', fire: '101' },
  NZ: { name: 'New Zealand', police: '111', ambulance: '111', fire: '111' },
  PH: { name: 'Philippines', police: '911', ambulance: '911', fire: '911' },
  PT: { name: 'Portugal', police: '112', ambulance: '112', fire: '112' },
  SE: { name: 'Sweden', police: '112', ambulance: '112', fire: '112' },
  SG: { name: 'Singapore', police: '999', ambulance: '995', fire: '995' },
  TH: { name: 'Thailand', police: '191', ambulance: '1669', fire: '199', tourist: '1155' },
  TR: { name: 'Türkiye', police: '112', ambulance: '112', fire: '112' },
  TW: { name: 'Taiwan', police: '110', ambulance: '119', fire: '119' },
  US: { name: 'United States', police: '911', ambulance: '911', fire: '911' },
  VN: { name: 'Vietnam', police: '113', ambulance: '115', fire: '114' },
  ZA: { name: 'South Africa', police: '10111', ambulance: '10177', fire: '10177' },
};

// 112 reaches emergency services from almost any GSM mobile phone worldwide.
export const FALLBACK = '112';

import type { Diet } from './store';

export const DIET_OPTIONS: { value: Diet; label: string }[] = [
  { value: 'none', label: 'Anything' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
  { value: 'jain', label: 'Jain' },
  { value: 'pescatarian', label: 'Pescatarian' },
];

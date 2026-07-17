// 번들 테마 정적 목록 — vite json import
import darkPlus from '../../assets/themes/dark-plus.json';
import lightPlus from '../../assets/themes/light-plus.json';
import monokai from '../../assets/themes/monokai.json';
import oneDarkPro from '../../assets/themes/one-dark-pro.json';

export const BUNDLED_THEME_DATA: Record<string, unknown> = {
  'dark-plus': darkPlus, 'light-plus': lightPlus, monokai, 'one-dark-pro': oneDarkPro,
};
export const BUNDLED_THEMES = [
  { id: 'dark-plus', name: 'Dark+ (기본)' },
  { id: 'light-plus', name: 'Light+' },
  { id: 'monokai', name: 'Monokai' },
  { id: 'one-dark-pro', name: 'One Dark Pro' },
];

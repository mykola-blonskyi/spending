import { create } from 'zustand';
import {
  browserLanguages,
  detectLocale,
  type Locale,
  readSavedLocale,
  saveLocale,
} from './locales';

type LocaleState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectLocale(readSavedLocale(), browserLanguages()),
  setLocale: (locale) => {
    saveLocale(locale);
    set({ locale });
  },
}));

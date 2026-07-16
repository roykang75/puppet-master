import type { SiApi } from '../../preload/preload';

declare global {
  interface Window {
    si: SiApi;
  }
}
export {};

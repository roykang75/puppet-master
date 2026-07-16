import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts', // vitest는 *.test.ts만 수집 — 상호 간섭 없음
  timeout: 120_000,
  workers: 1,
});

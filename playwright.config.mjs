import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests',
  testMatch:['browser.spec.mjs','revision-browser.spec.mjs'],
  timeout:30000,
  expect:{timeout:6000},
  fullyParallel:false,
  workers:1,
  retries:0,
  outputDir:'test-results',
  reporter:'list',
  use:{browserName:'chromium',headless:true,viewport:{width:1440,height:960},screenshot:'only-on-failure',trace:'retain-on-failure'},
});

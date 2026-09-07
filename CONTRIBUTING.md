# Contributing

Keep the tool portable, local-first and simple to review. Discuss changes that add network services, model dependencies or host-specific plugins before implementing them.

Use Node.js 22+:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

For a behavior change, add a focused failing test and verify the fix. Test real HTTP and temporary files, not a developer's personal library. For UI changes, inspect desktop and 390px layouts, full-image framing, comparison, note entry, keyboard controls, empty states and failure recovery.

Never commit personal photos, user feedback, browser profiles, generated test screenshots, private paths, credentials or unrelated project history. Use synthetic fixtures. Keep runtime dependencies empty unless a clearly justified change is agreed upon.

The versioned [data contract](docs/contract.md) is shared by UI, CLI and Skill. Changes to it need corresponding validation, tests and documentation. Distinguish a supported integration mechanism from an actually executed host-version compatibility test.

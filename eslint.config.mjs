import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Flat config (ESLint 9). This file is .mjs (ESM) because package.json has no
// "type": "module" — the app's main/preload build as CommonJS, but tooling
// config can still be ESM via the .mjs extension.
export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'Product website/dist/**',
      'Product website/.cache/**',
      'Product website/node_modules/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS tooling/build scripts (e.g. scripts/build-watcher.mjs) run under
    // Node, not the browser — declare Node globals so `process`/`console` etc.
    // aren't flagged as undefined by the recommended `no-undef` rule.
    files: ['**/*.mjs', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'Product website/src/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    plugins: {
      react,
      'react-hooks': reactHooks
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 19 + automatic JSX runtime
      'react/jsx-uses-react': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
)

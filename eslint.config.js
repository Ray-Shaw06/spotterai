// ESLint flat config.
//
// This repo has no build step and no framework, which is a feature: the code
// that runs in the browser is the code in the file. The cost of that choice is
// that nothing sits between a typo and production. A `docuemnt.querySelector`
// typo in vanilla ES modules is a runtime error on a user's phone, not a build
// failure. That is the specific hole this config plugs, which is why `no-undef`
// matters more here than in a typical TypeScript project.
//
// Rules are chosen to be *worth fixing*, not to score points. Anything that
// fires on idiomatic code already in this repo was considered for the ignore
// list rather than mass-rewriting 34k lines to satisfy a style preference.
// Style is not what this gate is for; correctness is.

import js from "@eslint/js";
import globals from "globals";

// Correctness rules applied everywhere, on top of eslint:recommended.
const correctness = {
  // The headline rule for a no-build-step codebase: an undeclared identifier
  // is a ReferenceError at runtime, and nothing else in this repo catches it.
  "no-undef": "error",

  // Unused vars are usually the fossil of a refactor that was not finished.
  // Args are checked after-used only, so (err, req, res) style signatures and
  // deliberately-ignored leading params do not produce noise.
  "no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      // `const { penalty, ...rest } = check` is how evaluator.js strips an
      // internal field out of the payload it makes public. The binding is
      // meant to be unused — that is the whole point of writing it — so
      // flagging it would punish the clearest way to express the intent.
      ignoreRestSiblings: true,
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^_",
    },
  ],

  // `==` against null is the one coercion that is idiomatic and safe, so it is
  // allowed; every other loose comparison is a latent bug.
  eqeqeq: ["error", "always", { null: "ignore" }],

  // Real bugs, not style: each of these is code that does not do what it reads
  // like it does.
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-implicit-coercion": "off",
  "no-constant-binary-expression": "error",
  "no-self-compare": "error",
  "no-unreachable-loop": "error",
  "no-template-curly-in-string": "error",
  "no-promise-executor-return": "error",
  "no-sequences": "error",

  // Deliberately OFF, with reasons. A gate that cries wolf gets ignored, and
  // an ignored gate is worth less than no gate at all — so a rule earns its
  // place here only if its findings are worth acting on in this codebase.
  //
  // require-atomic-updates: 14 hits, all false positives. It flags the
  //   `busy = true; await f(); busy = false` guard and `el.disabled = true;
  //   await f(); el.disabled = false` — both of which are correct in a
  //   single-threaded event loop and are in fact the standard way to write a
  //   re-entrancy guard. The rule is aimed at genuinely shared mutable state.
  "require-atomic-updates": "off",
  // no-unmodified-loop-condition: flags `while (cursor <= end)` in
  //   calendarMonth, where `cursor` is a Date advanced by `cursor.setDate()`.
  //   The rule cannot see mutation through a method call, so it reads an
  //   in-place mutation as a non-terminating loop. It is wrong, and the loop
  //   terminates.
  "no-unmodified-loop-condition": "off",
  // no-return-assign: pure style. `onclick = () => (state.x = v)` is used
  //   throughout and reads fine; rewriting ~15 call sites to add braces buys
  //   nothing.
  "no-return-assign": "off",
  // no-await-in-loop: sequential awaits are often exactly what is wanted
  //   here (ordered writes, rate-limited calls).
  "no-await-in-loop": "off",
  "no-throw-literal": "error",
  "array-callback-return": ["error", { allowImplicit: true }],
  "no-duplicate-imports": "error",

  // A bare `console.log` left in shipped browser code is debris; warn rather
  // than error so it never blocks a commit, but it stays visible.
  "no-console": ["warn", { allow: ["warn", "error", "info"] }],
};

export default [
  {
    // Vendored, generated, or binary-adjacent paths. `docs/superpowers` is
    // third-party content that this repo does not own and must not restyle.
    ignores: [
      "node_modules/**",
      "coverage/**",
      "fonts/**",
      "docs/superpowers/**",
      ".vercel/**",
    ],
  },

  js.configs.recommended,

  {
    // Browser ES modules: everything at the repo root that the page loads.
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Loaded from a CDN as a global by index.html rather than imported.
        Chart: "readonly",
      },
    },
    rules: correctness,
  },

  {
    // The service worker has its own global scope; `self` is a
    // ServiceWorkerGlobalScope, not a Window.
    files: ["service-worker.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    rules: correctness,
  },

  {
    // Serverless functions and shared server libs run on Node, not in a page.
    files: ["api/**/*.js", "lib/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: correctness,
  },

  {
    // Tests and tooling: Node, plus node:test's globals via import.
    files: ["test/**/*.js", "scripts/**/*.mjs", "integration/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...correctness,
      // Test files legitimately print; the eval harnesses are CLI reporters
      // whose entire job is stdout.
      "no-console": "off",
    },
  },
];

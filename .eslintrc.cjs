module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
    "prettier"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.eslint.json"],
    tsconfigRootDir: __dirname
  },
  plugins: ["@typescript-eslint"],
  rules: {
    // Type-aware "unsafe" rules are advisory here: the code that crosses the
    // chrome messaging boundary is untyped by nature and is validated with zod.
    "@typescript-eslint/no-unsafe-assignment": "warn",
    "@typescript-eslint/no-unsafe-member-access": "warn",
    "@typescript-eslint/no-unsafe-call": "warn",
    "@typescript-eslint/no-unsafe-argument": "warn",
    "@typescript-eslint/no-unsafe-return": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/require-await": "warn",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/prefer-nullish-coalescing": "warn",
    "@typescript-eslint/prefer-optional-chain": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-floating-promises": "warn",
    "no-restricted-globals": [
      "error",
      {
        "name": "fetch",
        "message": "Use net.ts for outbound requests. fetch is only allowed in apps/extension/src/background/net.ts"
      },
      {
        "name": "XMLHttpRequest",
        "message": "Use net.ts for outbound requests. XMLHttpRequest is banned."
      },
      {
        "name": "sendBeacon",
        "message": "Use net.ts for outbound requests. sendBeacon is banned."
      },
      {
        "name": "WebSocket",
        "message": "WebSocket is banned. All outbound traffic must go through net.ts."
      }
    ]
  },
  overrides: [
    {
      "files": ["apps/extension/src/background/net.ts", "apps/backend/**"],
      "rules": {
        "no-restricted-globals": "off"
      }
    },
    {
      "files": ["**/*.config.*", "**/scripts/**", "**/.eslintrc.*", "**/vitest.config.*"],
      "rules": {
        "@typescript-eslint/no-floating-promises": "off"
      }
    }
  ],
  ignorePatterns: ["node_modules/", "dist/", "build/", "generated/", ".turbo/", "*.config.*"]
};
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
    project: ["./tsconfig.base.json", "./packages/*/tsconfig.json", "./apps/*/tsconfig.json", "./eval/**/tsconfig.json"],
    tsconfigRootDir: __dirname
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
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
      "files": ["apps/extension/src/background/net.ts"],
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
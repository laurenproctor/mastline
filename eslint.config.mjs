import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * ESLint is deliberately pinned to the 9.x line.
 *
 * ESLint 10 removed a rule-context API that eslint-plugin-react and
 * eslint-plugin-jsx-a11y still depend on, and both are pulled in by
 * eslint-config-next. On ESLint 10 the config throws on load, and installing
 * around it costs the JSX accessibility rules this project specifically wants.
 * Move to 10 once those plugins ship a compatible release.
 *
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
  {
    ignores: [".next/**", "out/**", "build/**", "coverage/**", "node_modules/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Money values are integers and statuses are unions; loose equality would
      // let a minor-unit 0 compare equal to null.
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      // Tests deliberately assert on values the compiler already narrowed.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];

export default config;

import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import sortImports from "eslint-plugin-sort-imports-es6-autofix";

// Flat-config equivalent of the previous eslintrc-based setup, keeping the
// same rule set and severities so lint output stays comparable across the
// upgrade. The type-checked rules consume a lot of build time but the repo
// has never been "any"-clean; keep them on.
export default defineConfig([
    globalIgnores(["node_modules/**/*", "build/**/*", "dist/**/*"]),
    {
        files: ["**/*.ts"],
        plugins: {
            "sort-imports-es6-autofix": sortImports,
        },
        extends: [
            js.configs.recommended,
            importX.flatConfigs.recommended,
            importX.flatConfigs.typescript,
            tseslint.configs.recommendedTypeChecked,
            prettierRecommended,
        ],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: ["./tsconfig.json"],
            },
        },
        rules: {
            // The code base leans on "any" in a few external util call sites;
            // these stay warnings until those are cleaned up. See the lint
            // warning baseline when touching this list.
            "@typescript-eslint/no-unsafe-call": "warn",
            "@typescript-eslint/no-unsafe-member-access": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unsafe-argument": "warn",
            "@typescript-eslint/no-unsafe-assignment": "warn",
            "@typescript-eslint/no-unsafe-return": "warn",
            "@typescript-eslint/require-await": "error",

            // Allows the "interface X extends Y {}" shape used to alias
            // declaration types in the .d.ts sources.
            "@typescript-eslint/no-empty-object-type": ["error", {
                allowInterfaces: "with-single-extends",
            }],

            "import-x/order": ["error", {
                alphabetize: {
                    caseInsensitive: true,
                    order: "asc",
                },
            }],
            "import-x/no-unresolved": "off",

            // The CJS util packages this server uses (gm, walk, socket.io,
            // fluent-ffmpeg) are deliberately imported as defaults; the
            // heuristic suggesting named exports instead was silent with
            // the old resolver and converting them would change runtime
            // import shapes.
            "import-x/no-named-as-default": "off",
            "import-x/no-named-as-default-member": "off",

            // The autofix plugin keeps import statements in the order enforced
            // by this rule.
            "sort-imports": ["error", {
                ignoreCase: true,
                ignoreDeclarationSort: true,
                allowSeparatedGroups: true,
            }],

            "prettier/prettier": "warn",
        },
    },
]);

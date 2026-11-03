import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// DEL-2 / TEN-15: one codebase for every tenant. Source never names a tenant: no tenant
// ids (UUID literals), no tenant slugs or brand names, and no branching on tenant
// identity; tenant differences come from data, settings and platform feature flags.
// Brand names and slugs known today; extend when a tenant is onboarded (DEC-008).
const TENANT_NAMES = ["numa", "kliniknuma", "numa-klinik", "numa klinik"];
const tenantNamePattern = `/(^|[^a-z])(${TENANT_NAMES.join("|")})([^a-z]|$)/i`;
const tenantIdentity = "/^(tenant_?id|tenant_?slug|slug|tenant_?name|legal_?name)$/i";

const tenantLiteralRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "Literal[value=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i]",
      message: "No UUID literals in src/: tenant and object ids come from data (TEN-15).",
    },
    {
      selector: `Literal[value=${tenantNamePattern}]`,
      message: "No tenant slugs or brand names in src/ (TEN-15); use tenant data.",
    },
    {
      selector: `TemplateElement[value.raw=${tenantNamePattern}]`,
      message: "No tenant slugs or brand names in src/ (TEN-15); use tenant data.",
    },
    {
      selector: `JSXText[value=${tenantNamePattern}]`,
      message: "No tenant slugs or brand names in src/ (TEN-15); use tenant data.",
    },
    {
      selector: `BinaryExpression[operator=/^[!=]==?$/]:matches([left.property.name=${tenantIdentity}], [right.property.name=${tenantIdentity}], [left.name=${tenantIdentity}], [right.name=${tenantIdentity}]):matches([left.type='Literal'], [right.type='Literal'], [left.type='TemplateLiteral'], [right.type='TemplateLiteral'])`,
      message:
        "Do not branch on tenant identity (TEN-15); use settings or the platform feature-flag API.",
    },
    {
      selector: `SwitchStatement:matches([discriminant.property.name=${tenantIdentity}], [discriminant.name=${tenantIdentity}])`,
      message:
        "Do not branch on tenant identity (TEN-15); use settings or the platform feature-flag API.",
    },
    {
      // Inline Server Actions are POST endpoints the isolation gate cannot discover;
      // put them in a module whose first statement is "use server" (DEC-008).
      selector:
        ":function > BlockStatement > ExpressionStatement[directive='use server']",
      message:
        'No inline "use server": move the action to a "use server" module so the isolation gate covers it (DEC-008).',
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["src/**/*.{ts,tsx,js,jsx,mjs}"], rules: tenantLiteralRules },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Research evidence: captured third-party bundles, never linted.
    "docs/research/**",
    // Local agent scratch (git-excluded on the device; never in CI).
    ".pi/**",
  ]),
]);

export default eslintConfig;

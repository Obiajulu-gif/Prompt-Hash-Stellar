/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

declare module "jest-axe" {
  export interface AxeResults {
    violations: Array<{
      id: string;
      impact?: string | null;
      description: string;
      nodes: unknown[];
    }>;
  }
  export function axe(container: Element | string, options?: unknown): Promise<AxeResults>;
  export const toHaveNoViolations: {
    toHaveNoViolations: (results: AxeResults) => { pass: boolean; message: () => string };
  };
}

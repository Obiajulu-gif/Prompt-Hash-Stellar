/**
 * Shared response contract for the *simple* (scalar) validators in
 * `src/debug/validate/methods/`.
 *
 * The dominant shape used across these validators is:
 *
 *   - `false`  → the value is valid (no error)
 *   - `string` → a human-readable error message describing why it is invalid
 *
 * Callers such as `RenderPrimitivesType.handleValidate` rely on this exact
 * shape: a truthy result means "invalid", and the message is the error text.
 *
 * Exceptions (documented, not the rule): a couple of composite validators
 * (`getClaimaintsError`, `getTimeBoundsError`) intentionally return structured
 * objects instead of a bare `string`. `getXdrError` previously diverged from
 * the contract by returning `{ result, message }`; it now conforms to
 * `ValidatorResult` so it cannot be mishandled by callers written against the
 * `string | false` shape.
 */
export type ValidatorResult = string | false;

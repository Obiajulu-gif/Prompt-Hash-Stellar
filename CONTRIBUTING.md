# Contributing

PromptHash Stellar is an early-stage Soroban application. Contributions are welcome, but they should improve correctness, security, and maintainability rather than introduce speculative complexity.

## Contribution Priorities

- contract correctness and test coverage
- secure wallet-auth and unlock flows
- developer tooling and local setup quality
- marketplace UX improvements tied to real product flows
- documentation that clarifies architecture or operational assumptions

## Before You Start

- open an issue before large feature work or architecture changes
- keep pull requests focused on one concern
- avoid mixing contract logic, frontend refactors, and docs cleanup unless they are directly related
- do not commit secrets, private keys, or environment-specific contract IDs

## Local Setup

```bash
yarn install
cd server && npm install && cd ..
cp .env.example .env
```

## Recommended Validation

```bash
yarn test
yarn build
cargo test -p prompt-hash
```

If you changed the optional Node workspace:

```bash
cd server
npm run build
```

## Engineering Expectations

- prefer explicit TypeScript and Rust code over clever abstractions
- keep Soroban logic small, auditable, and easy to reason about
- document security-sensitive assumptions in code or PR notes
- avoid adding hidden off-chain trust requirements to contract-critical flows

## Pull Request Checklist

Include the following in each PR:

- the problem being solved
- the chosen implementation approach
- the commands or tests used for validation
- screenshots for user-facing UI changes when relevant

## Security Reporting

If you discover a vulnerability related to contract logic, decryption, signatures, or secret handling, do not publish exploit details in a public issue. Contact the maintainer privately first.

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.

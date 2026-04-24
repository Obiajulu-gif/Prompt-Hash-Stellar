# Contributing

Thank you for contributing to PromptHash Stellar.

## Scope

This project is an in-development Soroban application for encrypted prompt licensing on Stellar. Contributions should prioritize:

- contract correctness and test coverage
- secure unlock and wallet-auth flows
- clear developer ergonomics
- practical marketplace UX

## Before You Start

- Open an issue for significant feature work or architectural changes.
- Keep pull requests focused. Avoid mixing product docs, contract changes, and unrelated UI cleanup in one PR.
- Preserve existing user changes in the repo when working locally.

## Development Workflow

1. Fork the repository and create a branch from `main`.
2. Install dependencies for both the frontend and `server/` workspace.
3. Copy `.env.example` to `.env` and configure local values.
4. Make changes with tests or validation steps where possible.
5. Submit a pull request with a clear explanation of what changed and why.

## Recommended Local Checks

```bash
yarn test:frontend
yarn build
cargo test -p prompt-hash
```

If you changed the auxiliary server:

```bash
cd server
npm run build
```

## Coding Expectations

- Prefer TypeScript and Rust changes that are explicit and easy to audit.
- Keep smart contract logic simple and well-bounded.
- Document security-sensitive assumptions, especially around signing, decryption, and key handling.
- Avoid introducing hidden off-chain dependencies for contract-critical flows.
- Add or update frontend integration coverage when wallet, contract, unlock, or dashboard behavior changes.
- Follow `docs/frontend-testing.md` for the shared mocked-wallet and mocked-Soroban testing pattern.

## Pull Request Guidelines

Include:

- a short summary of the problem
- the implemented approach
- validation steps performed
- screenshots for UI changes when relevant

## Security

If you find a security issue related to contract behavior, decryption, wallet auth, or secret handling, do not open a public issue with exploit details. Contact the maintainer privately first.

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.

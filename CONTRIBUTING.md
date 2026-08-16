# Contributing

This repository is a monorepo. Keep changes scoped to the foundation until application work is explicitly started.

## Tooling

- Node.js 22
- pnpm 9 (see `packageManager` in the root `package.json`)
- TypeScript project references
- Turborepo task graph
- ESLint, Prettier, Vitest

## Workflow

1. Create a branch from `main`.
2. Make the smallest change that solves the task.
3. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
4. Open a pull request.

## Packages and apps

- Shared code belongs in `packages/`.
- Runnable processes belong in `apps/`.
- New packages and apps must include `package.json`, `tsconfig.json`, and a `src/index.ts` entry.
- Add a TypeScript project reference in the root `tsconfig.json`.

## Style

- TypeScript strict mode is required.
- Format with Prettier.
- Do not commit `.env` files.
- Do not add application logic unless the task asks for it.

## Pull requests

- Describe the change and how it was verified.
- Keep unrelated refactors out of the same PR.

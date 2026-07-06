# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js 22 TypeScript application with a React/Vite client and an Express server.

- `client/src/`: UI components, styles, API wrappers, graph editing, layout, and export logic.
- `server/`: Express entry point, API routes, SQLite persistence, document parsing, and LLM providers.
- `shared/`: contracts used by both runtimes. `shared/processGraph.ts` is the canonical graph type, JSON schema, and runtime validator.
- `scripts/`: manual verification tooling and fixtures.
- `dist/`: generated client build; do not commit it.

Keep provider-specific behavior in `server/lib/providers/`. Add shared graph fields and validation together so client, server, and stored data do not drift.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start Express on port 3001 and Vite on port 5173.
- `npm run dev:server` / `npm run dev:client`: run one side independently.
- `npm run typecheck`: run strict TypeScript checks without emitting files.
- `npm run build`: build the client into `dist/`.
- `npm start`: serve the API and built client in production mode.
- `npm run verify`: run the fixture-based extraction check. Set the API key required by `LLM_MODEL`.

Before submitting changes, run `npm run typecheck && npm run build`. Run `npm run verify` when extraction, prompts, schemas, parsing, or providers change.

## Coding Style & Naming Conventions

Use TypeScript, ESM, two-space indentation, double quotes, and semicolons, matching existing files. React components use `PascalCase` filenames; functions and variables use `camelCase`; constants use `UPPER_SNAKE_CASE` when truly global. Prefer small typed helpers over duplicated inline transformations.

Use `@shared/*` for shared imports. Server-side relative TypeScript imports must include `.ts`. No formatter or linter is configured, so preserve the surrounding style and rely on `npm run typecheck`.

## Testing Guidelines

There is currently no unit-test framework or coverage threshold. Treat `scripts/verify-extract.ts` as an integration check and place reusable inputs under `scripts/fixtures/`. New deterministic logic should include focused tests if a test runner is introduced; otherwise extend verification scripts with explicit pass/fail assertions.

## Commit & Pull Request Guidelines

History uses short, imperative subjects such as `Add OpenRouter provider + open-source model support`. Keep commits focused and avoid generated files, databases, or secrets.

Pull requests should explain the user-visible change, list verification commands, link relevant issues, and include screenshots for UI or diagram-layout changes. Document new environment variables in `.env.example`; never commit `.env`, API keys, or `*.db` files.

# AgentKit CLI - Development Instructions

## **Project Overview**

- CLI tool for creating and running AI agents locally
- TypeScript-based command-line interface
- Commands: init, install, list, login, logout, publish, run, search, update, whoami
- Published as `@agentage/cli` package

## **Project Agreements**

- Default branch: `master`
- Repository: `agentage/cli`
- Branch names: `feature/*`, `bugfix/*`, `hotfix/*`, `setup-*`
- Commits: `feat:`, `fix:`, `chore:` (max 72 chars)
- Verifications: `npm run verify` (type-check + lint + build + test)

## **Publishing**

- Published to npm as `@agentage/cli`
- Auto-publish on push to `master` when `package.json` version is bumped.

## **Release Strategy**

- 🎯 **MINIMAL FIRST**: Keep commands simple and focused
- 🚫 **No Over-Engineering**: Single responsibility per command
- ⚡ **Essential Only**: Core CLI functionality

## **Rules**

- 📊 Use icons/tables for structured output
- 📁 NO extra docs unless explicitly asked
- 🐙 GitHub: owner `agentage`, repo `cli`
- ⚡ Prefer function calls over terminal commands
- 📂 Source code in `src/` directory

## **Coding Standards**

### TypeScript

- 🚫 No `any` type - explicit types always
- 📤 Named exports only (no default exports)
- 📏 Files <300 lines, commands <200 lines
- 🔄 Functional: arrow functions, async/await, destructuring
- 🏗️ Interfaces over classes
- ✅ ESM modules (`type: "module"`)

### Naming

- **Interfaces**: `AgentConfig`, `RegistryAgent`, `LockfileEntry`
- **Types**: `CommandOptions`, `ServiceConfig`
- **Files**: `command.ts`, `service.ts`, `*.types.ts`, `*.test.ts`

## **Tech Stack**

- **Language**: TypeScript 5.3+ (strict mode)
- **Module**: ESNext with ESM
- **Testing**: Jest 30+ with ts-jest
- **Linting**: ESLint 9+ (flat config)
- **Formatting**: Prettier
- **Package Manager**: npm (workspaces)

## **Node Requirements**

- Node.js >= 20.0.0
- npm >= 10.0.0

## **CLI Patterns**

**Command Structure**:

```typescript
import { Command } from "commander";

export const myCommand = new Command("name")
  .description("Command description")
  .option("-o, --option <value>", "Option description")
  .action(async (options) => {
    // Implementation
  });
```

**Service Pattern**:

```typescript
export const myService = {
  async doSomething(): Promise<Result> {
    // Implementation
  },
};
```

## **Workspace Structure**

```
src/
  cli.ts            # Main CLI entry point
  index.ts          # Package exports
  commands/         # CLI commands (init, run, install, etc.)
  services/         # Business logic (auth, registry)
  schemas/          # Zod validation schemas
  types/            # TypeScript type definitions
  utils/            # Utility functions
```

## **Scripts**

All packages support:

- `npm run build` - Build TypeScript
- `npm run type-check` - TypeScript validation
- `npm run lint` - ESLint check
- `npm run lint:fix` - Auto-fix linting
- `npm run test` - Run Jest tests
- `npm run test:watch` - Watch mode
- `npm run test:coverage` - Coverage report
- `npm run verify` - All checks
- `npm run clean` - Clean build artifacts

## **Quality Gates**

- ✅ Type check must pass
- ✅ Linting must pass (no warnings)
- ✅ All tests must pass
- ✅ Coverage >= 70% (branches, functions, lines, statements)
- ✅ Build must succeed

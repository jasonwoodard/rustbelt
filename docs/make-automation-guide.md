# Make Automation Guide

This project uses a root-level `Makefile` to provide a single, consistent
entry point for common development tasks across the TypeScript and Python
packages. You don't need to remember which `npm` script or `pytest` flag to
use — just run `make <target>`.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| `make` | any GNU Make | Ships with macOS Xcode CLT and most Linux distros |
| `node` / `npm` | ≥ 20 | Required for the TypeScript solver-cli |
| `python` | ≥ 3.11 | Required for the atlas-python package |
| `pip` | any | Used to install atlas-python in editable mode |

Verify you have `make` available:

```sh
make --version
# GNU Make 3.81 (or similar)
```

---

## Quick Reference

```
make install          # one-time setup: install all dependencies
make build            # compile TypeScript
make test             # run every test suite
make lint             # lint TypeScript sources
make clean            # delete compiled output
make help             # print this list
```

---

## How Makefiles Work (the Basics)

A `Makefile` is a plain text file that defines **targets** and the **recipe**
(shell commands) needed to build or run them. The basic syntax is:

```makefile
target-name: dependency1 dependency2
	shell command here        # ← MUST be indented with a TAB, not spaces
	another command
```

When you run `make target-name`, Make:
1. Checks that all listed dependencies are up to date.
2. Runs the shell recipe if they are not (or if the target is `.PHONY`).

### PHONY targets

A `.PHONY` target is one that doesn't produce a file — it just runs commands.
Every target in this project is declared `.PHONY` so Make always executes the
recipe regardless of whether a file with that name happens to exist.

```makefile
.PHONY: test
test: test-cli test-atlas   # run both sub-targets first
```

### Variables

Variables reduce repetition and make it easy to override values from the
command line:

```makefile
CLI_DIR := packages/solver-cli   # defined in the Makefile

# Override at call time:
make test CLI_DIR=packages/other-cli
```

---

## Target Walkthrough

### `make install`

```sh
make install
```

Runs two commands in sequence:

1. `npm install` — installs Node dependencies for the entire monorepo workspace.
2. `pip install -e "packages/atlas-python[dev]"` — installs the Python package
   in *editable* mode (`-e`) so source changes are reflected immediately, and
   includes the `[dev]` extras (e.g. `pytest`).

Run this once after cloning, and again whenever `package.json` or
`pyproject.toml` changes.

---

### `make build`

```sh
make build
```

Compiles the TypeScript solver-cli via `tsc` and bundles the day-of browser
app with `esbuild`. Output lands in `packages/solver-cli/out/`.

There's also a narrower target if you only need the browser bundle:

```sh
make build-day-of
```

---

### `make test`

```sh
make test
```

Runs both sub-suites in order:

| Sub-target | What it runs |
|------------|-------------|
| `test-cli` | `vitest run` inside `packages/solver-cli` |
| `test-atlas` | `python -m pytest packages/atlas-python/tests` |

You can run each suite independently:

```sh
make test-cli        # TypeScript unit tests only
make test-atlas      # Python tests only
make test-integration  # solver-cli integration tests
```

---

### `make lint`

```sh
make lint
```

Runs ESLint on the TypeScript sources in `packages/solver-cli`. Fix reported
issues before committing.

---

### `make clean`

```sh
make clean
```

Deletes generated output so you can start a build from scratch:

- `packages/solver-cli/out/` and `dist/` (TypeScript build artifacts)
- Python `__pycache__` directories and `.egg-info` folders

Useful when you suspect stale compiled files are causing odd behaviour.

---

## Common Workflows

### First-time setup

```sh
git clone <repo-url>
cd rustbelt
make install
```

### Before opening a pull request

```sh
make lint
make test
```

### Rebuild after switching branches

```sh
make clean
make build
```

### Run only the tests you care about while developing

```sh
# Iterate quickly on a single suite:
make test-cli
# or
make test-atlas
```

---

## Extending the Makefile

Adding a new target is straightforward. Open `Makefile` and follow this
pattern:

```makefile
.PHONY: format
format:
	npm run --workspace packages/solver-cli format
	black packages/atlas-python/src
```

Then add a line to the `help` target so the new target shows up in `make help`:

```makefile
@echo "  format           Auto-format TypeScript and Python sources"
```

Keep targets focused: one target, one responsibility. Chain them with
dependencies when order matters.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `make: command not found` | `make` not installed | `brew install make` (macOS) or `apt install make` (Ubuntu) |
| `Makefile:N: *** missing separator. Stop.` | Recipe line uses spaces instead of a tab | Open the file in an editor that shows whitespace and replace leading spaces with a single tab |
| `npm: command not found` | Node.js not installed | Install from [nodejs.org](https://nodejs.org) |
| `python: command not found` | Python not on `PATH` | Try `python3` or install Python ≥ 3.11 |
| Tests pass locally but fail in CI | Stale build artifacts | Run `make clean && make build && make test` |

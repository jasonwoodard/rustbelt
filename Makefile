# Rustbelt Monorepo — Makefile
#
# Run `make help` to see available targets.
#
# Convention:
#   PHONY targets never produce a file; they always re-run when invoked.
#   Variable overrides can be passed on the command line:
#     make test VITEST_REPORTER=verbose

.DEFAULT_GOAL := help

# ── Directories ────────────────────────────────────────────────────────────────
CLI_DIR   := packages/solver-cli
ATLAS_DIR := packages/atlas-python

# ── Help ───────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Setup"
	@echo "  install          Install all dependencies (npm + Python dev extras)"
	@echo ""
	@echo "Build"
	@echo "  build            Compile TypeScript (solver-cli)"
	@echo "  build-day-of     Bundle the day-of browser app only"
	@echo ""
	@echo "Test"
	@echo "  test             Run all tests (TypeScript + Python)"
	@echo "  test-cli         Run solver-cli unit tests only"
	@echo "  test-integration Run solver-cli integration tests only"
	@echo "  test-atlas       Run atlas-python tests only"
	@echo ""
	@echo "Lint"
	@echo "  lint             ESLint the TypeScript sources"
	@echo ""
	@echo "Clean"
	@echo "  clean            Remove compiled output directories"
	@echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────
.PHONY: install
install:
	npm install
	pip install -e "$(ATLAS_DIR)[dev]"

# ── Build ──────────────────────────────────────────────────────────────────────
.PHONY: build
build:
	npm run --workspace $(CLI_DIR) build

.PHONY: build-day-of
build-day-of:
	npm run --workspace $(CLI_DIR) build:day-of-app

# ── Test ───────────────────────────────────────────────────────────────────────
.PHONY: test
test: test-cli test-atlas

.PHONY: test-cli
test-cli:
	npm run --workspace $(CLI_DIR) test

.PHONY: test-integration
test-integration:
	npm run --workspace $(CLI_DIR) test:integration

.PHONY: test-atlas
test-atlas:
	python -m pytest $(ATLAS_DIR)/tests

# ── Lint ───────────────────────────────────────────────────────────────────────
.PHONY: lint
lint:
	npm run --workspace $(CLI_DIR) lint

# ── Clean ──────────────────────────────────────────────────────────────────────
.PHONY: clean
clean:
	rm -rf $(CLI_DIR)/out $(CLI_DIR)/dist
	find $(ATLAS_DIR) -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find $(ATLAS_DIR) -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true

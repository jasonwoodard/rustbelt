# Atlas v0.2 Task Board

This document captures the actionable tasks required to deliver Atlas v0.2. It is derived from the v0.2 goals and planning notes and is intended to guide execution through discrete, engineer-friendly work packages.

## 1. Metro Anchors and Sub-Clusters

| Task ID | Description | Status | Dependencies | Exit Criteria |
| --- | --- | --- | --- | --- |
| A2.1 | Implement DBSCAN/HDBSCAN-based anchor detection in `atlas.clustering` with configurable parameters for metro tuning. | DONE | Baseline scoring pipeline | Anchors generated for sample datasets with metrics logged. |
| A2.2 | Define sub-cluster nesting and persistence format, ensuring stable identifiers and parent-child relationships. | DONE | A2.1 | Sub-cluster JSON/CSV exports with schema draft. |
| A2.3 | Extend CLI to expose anchor and sub-cluster generation (flags or subcommands) with integration tests. | DONE | A2.1, A2.2 | CLI command produces anchors/sub-clusters, tests cover sample fixture. |
| A2.4 | Update fixture regeneration scripts to incorporate anchors/sub-clusters for regression coverage. | DONE. | A2.3 | Regenerated fixtures stored; CI regression leverages new artifacts. |

## 2. Posterior Trace Exports

| Task ID | Description | Status | Dependencies | Exit Criteria |
| --- | --- | --- | --- | --- |
| P2.1 | Persist `PosteriorPipeline.trace_records_` into JSONL/CSV outputs alongside priors. | DONE | Existing posterior pipeline | Trace payloads surfaced via `PosteriorPipeline.iter_traces()` and CLI `_write_posterior_trace` now land in trace files. |
| P2.2 | Unify prior, posterior, and blend trace schemas and document format versioning. | DONE | P2.1 | Shared schema published under `schema/atlas/v1/trace.schema.json`. |
| P2.3 | Add CLI switches/tests validating posterior/blend trace generation. | PENDING | P2.1, P2.2 | CLI integration tests pass, optional flags documented. |

## 3. Diagnostics and Reporting

| Task ID | Description | Status | Dependencies | Exit Criteria |
| --- | --- | --- | --- | --- |
| D2.1 | Implement correlation tables, distribution summaries, and QA signals in `atlas.diagnostics`. | PENDING | Anchors/sub-clusters available | Diagnostics functions return expected structures for sample data. |
| D2.2 | Decide on output formats (JSON/HTML/Parquet) and implement writers. | PENDING | D2.1 | Diagnostics emitted to disk with versioned filenames. |
| D2.3 | Wire diagnostics into CLI with default-on sidecar or flag and add regression tests. | PENDING | D2.1, D2.2 | CLI run produces diagnostics; tests assert file existence/shape. |

## 4. Solver Integration and Data Contracts

| Task ID | Description | Status | Dependencies | Exit Criteria |
| --- | --- | --- | --- | --- |
| S2.1 | Draft schemas for scores, anchors, and clusters under `schema/atlas/v1/`. | PENDING | Outputs defined (A2, P2) | JSON Schema files merged with version tags. |
| S2.2 | Integrate schema validation into Atlas CLI (e.g., via `jsonschema`). | PENDING | S2.1 | CLI fails invalid outputs, passes valid fixtures. |
| S2.3 | Create integration tests that run Solver against frozen Atlas outputs to validate contracts. | PENDING | S2.2 | Solver regression test suite consumes Atlas outputs successfully. |
| S2.4 | Document schema bump and release process for Atlas ⇄ Solver handoff. | PENDING | S2.1–S2.3 | Docs updated with versioning workflow. |

## 5. Documentation, Fixtures, Release Readiness

| Task ID | Description | Status | Dependencies | Exit Criteria |
| --- | --- | --- | --- | --- |
| R2.1 | Update user docs (`docs/atlas/README.md`, CLI examples) to include new commands/artifacts. | PENDING | Feature work complete | Docs merged with screenshots/examples where applicable. |
| R2.2 | Refresh synthetic fixtures and regeneration tooling to include anchors, diagnostics, and traces. | PENDING | A2, P2, D2 complete | Updated fixtures versioned and referenced by tests. |
| R2.3 | Expand integration/regression tests to cover new artifacts end-to-end. | PENDING | R2.2 | CI suite covers anchors, traces, diagnostics generation. |
| R2.4 | Prepare release notes and checklist for Atlas v0.2 GA. | PENDING | All above tasks | Release checklist published and shared. |

## Cross-Cutting Considerations

- Establish weekly checkpoint reviews to monitor progress across data science and platform tracks.
- Maintain alignment with Solver team on schema expectations to avoid contract drift.
- Track metrics for anchor quality and diagnostic usefulness to inform post-v0.2 iteration.

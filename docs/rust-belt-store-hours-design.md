# Store Open Hours Integration Design

## 1. Overview

The day solver currently assumes every candidate store can be visited at any time within the driver's day window. To model real-world constraints, add **store open hours** so the solver avoids planning visits when the store is closed.

This document explores the required input changes, functional requirements, use cases, implementation considerations, and the anticipated difficulty of adding the feature.

## 2. Requirements

- **StoreTime‑1:** Do not arrive before the store opens.
- **StoreTime‑2:** Do not arrive after the store has closed.
- **StoreTime‑3:** Do not arrive if the store will close before the required dwell time completes.
- **StoreTime‑4:** Do not include stores closed on the planned day of week.
- **StoreTime‑5:** Support multiple open/close windows per day (e.g., 09:00‑12:00 and 13:00‑17:00).
- **StoreTime‑6:** Treat all times as local to the store and expressed in 24‑hour `HH:MM` format.
- **StoreTime‑7:** If a store omits `openHours` entirely, assume it is open all day with no time restrictions.

## 3. Use Cases

1. **Early Arrival Deferred**
   - Day planned for **Monday**.
   - Store open **09:00‑17:00**.
   - Solver predicts arrival **08:45** → store infeasible at this position (violates StoreTime‑1); solver may attempt to revisit later. If no later slot exists, the store is excluded.

2. **Closed Mid‑Dwell**  
   - Day planned for **Monday**.
   - Store open **10:00‑12:00**.  
   - Arrival **11:30** with dwell **45 min** → store skipped (violates StoreTime‑3).

3. **Store Closed on Day**  
   - Day planned for **Sunday**.  
   - Store open **Mon‑Fri 09:00‑17:00** → store skipped (violates StoreTime‑4).

4. **Multiple Windows**
   - Day planned for **Tuesday**.
   - Store open **09:00‑12:00** and **13:00‑18:00**.
   - Arrival **12:30** → store skipped (not inside any window).
   - Arrival **13:15** with dwell **30 min** → accepted.

5. **No Hours Provided**
   - Day planned for **Friday**.
   - Store has no `openHours` field.
   - Arrival **05:00** with any dwell → accepted because no constraints apply.

## 4. Input Changes & Complexity

### 4.1 Day Context
Each solver run already targets a single day. To evaluate open hours, the solver must know the **day of week** (e.g., `"Monday"`).

### 4.2 Store Schema Extension
Add an optional `openHours` field per store:

```json
{
  "id": "s_103",
  "name": "Rusty Relics",
  "location": "86JHGR6C+2Q",
  "dwellMin": 12,
  "openHours": {
    "mon": [["09:00", "17:00"]],
    "tue": [["09:00", "12:00"], ["13:00", "17:00"]],
    "fri": [["20:00", "23:00"]]
  }
}
```

- Keys are three‑letter lowercase weekday codes (`mon`‑`sun`).
- Values are arrays of `[open, close]` strings in 24‑hour format. Each `close` must be later than its `open`.
- Missing day keys within `openHours` → store closed on that day.
- Omitting `openHours` entirely → store considered always open (no constraint).

**Input complexity:** increases JSON size per store and requires producers to specify accurate hours, but the structure remains simple and human readable.

## 5. Hours Specification Scenarios

| Store data | Entry for target day | Solver behavior |
| --- | --- | --- |
| `openHours` omitted | n/a | Store assumed open all day; no time checks applied. |
| `openHours` present with windows for day | yes | Enforce window and dwell checks. |
| `openHours` present but missing day entry | no | Store excluded from planning. |
| `openHours` present with empty array for day | yes, empty | Store treated as closed and excluded. |

## 6. Solver Adjustments

1. **Pre‑processing:**
   - If a store has no `openHours` field → keep (always eligible).
   - If `openHours` exists but lacks the target day → discard the store.
2. **Arrival Check:** When evaluating a candidate store, confirm arrival time falls within one of the day's open windows (StoreTime‑1/2).
3. **Dwell Check:** Ensure `arrival + dwell` is strictly before window close (StoreTime‑3).
4. **Diagnostics:** When a store is skipped due to hours, record the reason (early, late, insufficient window) for transparency.

These checks fit naturally into the existing feasibility logic and do not require re‑architecting the solver.

## 7. Implementation

The solver uses **Approach A** (pre‑filter + runtime checks). Key decision points:

- **Day filtering** –
  - If a store lacks `openHours` → mark as always eligible.
  - If `openHours` exists without the target day → drop the store.
- **Window evaluation** – for each candidate store arrival:
  - Iterate its `[open, close]` windows for the day.
  - Flag `close <= open` as an error (hours must be day‑bound).
  - If `arrival < open` → too early; continue to next window (store remains eligible later).
  - If `arrival ≥ close` → too late for this window.
  - If `arrival + dwell > close` → insufficient remaining time.
  - Otherwise → window feasible, schedule the store.
- **Diagnostics** – record the last failure reason (`early`, `late`, `insufficient`) when no window is feasible so users know why the store was skipped.

High‑level flow:

```
for store in storesForDay:
  for [open, close] in store.windows(day):
    if arrival < open: reason = 'early'; continue
    if arrival >= close: reason = 'late'; continue
    if arrival + dwell > close: reason = 'insufficient'; continue
    schedule(store)
    break
  else:
    markRejected(store, reason)
```

Stores rejected at one position may be reconsidered later if the solver reorders the route.

## 8. Difficulty Assessment

- **Implementation difficulty:** **Moderate**. Requires extending the data schema, parsing open hours, and adding checks in route construction. Algorithms remain unchanged.
- **Input complexity:** **Low‑to‑Moderate**. Each store gains a structured `openHours` object, increasing input size but not dramatically. Producers must provide correct hours.
- **Testing effort:** Additional unit tests for window logic and edge cases (multiple windows).

## 9. Assumptions

- Store times are local; no time‑zone conversions are required.
- Daylight saving transitions are out of scope; users must adjust inputs accordingly.
- Temporary or seasonal closures are ignored; inputs reflect correct day‑of‑trip hours.
- Store hours do **not** span midnight; each `close` must be later than its `open`. Invalid windows abort the run.

## 10. Future Enhancements

- Support holidays and exceptional closures.
- Allow **soft** windows (visit allowed before/after with penalty).
- Surface reasons for exclusion in output for user transparency.

---

### Appendix A. Considered Approaches

| Approach | Decision | Description | Pros | Cons |
| --- | --- | --- | --- | --- |
| **A. Pre‑filter + runtime checks** | **Selected** | Filter stores by day upfront, then apply arrival/dwell window checks during insertion and feasibility tests. | Minimal algorithm changes; deterministic; easy to reason about. | Requires additional checks in hot loops; does not consider open/close times during look‑ahead heuristics (may reduce optimality slightly). |
| **B. Encode as time‑window constraints in solver core** | Rejected | Treat each store window as a constraint, adjusting travel times or using scheduling algorithms (e.g., time‑window VRP). | Produces more optimal solutions; naturally handles windows in heuristics. | Higher implementation complexity; may slow solver significantly; overkill for single‑day planning. |
| **C. Post‑processing reroute** | Rejected | Plan ignoring hours, then re‑route or insert gaps after detecting violations. | Simplifies core solver. | Could yield infeasible or suboptimal itineraries; potentially expensive re‑solve steps. |



# Store Open Hours Integration Design

## 1. Overview

The day solver currently assumes every candidate store can be visited at any time within the driver's day window. To model real-world constraints, add **store open hours** so the solver avoids planning visits when the store is closed.

This document explores the required input changes, functional requirements, use cases, implementation approaches, and the anticipated difficulty of adding the feature.

## 2. Functional Requirements

Existing requirements provided:

- **StoreTime‑1:** Do not arrive before the store opens.
- **StoreTime‑2:** Do not arrive after the store has closed.
- **StoreTime‑3:** Do not arrive if the store will close before the required dwell time completes.
- **StoreTime‑4:** Do not include stores closed on the planned day of week.

Additional requirements:

- **StoreTime‑5:** Support multiple open/close windows per day (e.g., 09:00‑12:00 and 13:00‑17:00).
- **StoreTime‑6:** Handle stores that remain open past midnight (23:00‑02:00) by attributing closing time to the next day.
- **StoreTime‑7:** Treat all times as local to the store and expressed in 24‑hour `HH:MM` format.
- **StoreTime‑8:** If no open hours are supplied for a store, assume it is always closed (exclude).

## 3. Use Cases

1. **Early Arrival Blocked**  
   - Day planned for **Monday**.
   - Store open **09:00‑17:00**.  
   - Solver predicts arrival **08:45** → store skipped (violates StoreTime‑1).

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

5. **Over‑Midnight Window**  
   - Day planned for **Friday**.  
   - Store open **20:00‑02:00**.  
   - Arrival **23:30** with dwell **30 min** → accepted (closes 02:00 Saturday).  
   - Arrival **01:30** Saturday (during same run) → rejected if day of week is Saturday.

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
    "fri": [["20:00", "02:00"]]
  }
}
```

- Keys are three‑letter lowercase weekday codes (`mon`‑`sun`).
- Values are arrays of `[open, close]` strings in 24‑hour format.
- Missing days → store closed.

**Input complexity:** increases JSON size per store and requires producers to specify accurate hours, but the structure remains simple and human readable.

## 5. Solver Adjustments

1. **Pre‑processing:** For the target day, discard candidate stores lacking an `openHours` entry for that day.
2. **Arrival Check:** When evaluating a candidate store, confirm arrival time falls within one of the day's open windows (StoreTime‑1/2).
3. **Dwell Check:** Ensure `arrival + dwell` is strictly before window close (StoreTime‑3).
4. **Midnight Handling:** Interpret close times earlier than open times as spanning midnight (StoreTime‑6).
5. **Diagnostics:** When a store is skipped due to hours, record the reason (early, late, insufficient window) for transparency.

These checks fit naturally into the existing feasibility logic and do not require re‑architecting the solver.

## 6. Approaches

| Approach | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. Pre‑filter + runtime checks** | Filter stores by day upfront, then apply arrival/dwell window checks during insertion and feasibility tests. | Minimal algorithm changes; deterministic; easy to reason about. | Requires additional checks in hot loops; does not consider open/close times during look‑ahead heuristics (may reduce optimality slightly). |
| **B. Encode as time‑window constraints in solver core** | Treat each store window as a constraint, adjusting travel times or using scheduling algorithms (e.g., time‑window VRP). | Produces more optimal solutions; naturally handles windows in heuristics. | Higher implementation complexity; may slow solver significantly; overkill for single‑day planning. |
| **C. Post‑processing reroute** | Plan ignoring hours, then re‑route or insert gaps after detecting violations. | Simplifies core solver. | Could yield infeasible or suboptimal itineraries; potentially expensive re‑solve steps. |

### Recommended Approach
**Approach A** (pre‑filter + runtime checks) is recommended. It balances implementation effort with acceptable route quality for a day solver. The added checks are straightforward and can reuse existing time arithmetic utilities.

## 7. Difficulty Assessment

- **Implementation difficulty:** **Moderate**. Requires extending the data schema, parsing open hours, and adding checks in route construction. Algorithms remain unchanged.
- **Input complexity:** **Low‑to‑Moderate**. Each store gains a structured `openHours` object, increasing input size but not dramatically. Producers must provide correct hours.
- **Testing effort:** Additional unit tests for window logic and edge cases (multiple windows, midnight crossover).

## 8. Open Questions

- Are store times always in local time, or do we need time zone support for multi‑time‑zone routes?
- How should daylight saving changes be handled if day runs cross the transition?
- Do users need overrides for temporary closures or seasonal hours?

## 9. Future Enhancements

- Support holidays and exceptional closures.
- Allow **soft** windows (visit allowed before/after with penalty).
- Surface reasons for exclusion in output for user transparency.


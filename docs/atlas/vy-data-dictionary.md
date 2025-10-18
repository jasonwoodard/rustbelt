# VY Data Dictionary (Companion)

**Version:** v1.0

## 1) Visit-Level Inputs (one row per store visit)

| Field | Type | Required | Description |
|------|------|----------|-------------|
| StoreId | string | ✓ | Stable store identifier. |
| DateTime | datetime | ✓ | Visit timestamp (ISO 8601 preferred). |
| Type | enum | ✓ | {Thrift, Antique, Vintage, Other}. |
| Zip | string | ✓ | 5-digit ZCTA used for affluence join. |
| DwellMin (t) | number | ✓ | Minutes spent in-store (≥ 30 recommended). |
| PurchasedItems (N) | integer | ✓ | Count of items actually purchased. |
| HaulLikert (H) | integer (1–5) | ✓ | Observer rating of overall haul quality. |
| Spend (S) | number | optional | Total spend for the visit (pre-tax preferred; be consistent). |
| Notes | string | optional | Short free text (e.g., category emphasis). |
| ObserverId | string | ✓ | Identifier for observer (default “J”). |

**Comments**
- “Worthwhile” is operationalized strictly as **purchased** items. No “would-have-bought.”
- If a return occurs later, subtract from both N and S for that original visit (or log a correction row).

---

## 2) Derived Metrics (computed)

| Field | Type | Formula / Notes |
|------|------|------------------|
| ItemsPer45 | number | \( N / (t/45) \) |
| YieldScore (Y) | 1–5 | \( 1 + 4 \cdot ECDF(ItemsPer45) \) within a reference set (day/metro/corpus). |
| ValueScore (V) | 1–5 | \( V := H \) (MVP; may upgrade to ordinal model later). |
| EVH | number | \( V \cdot \text{ItemsPer45} \) (optional “value per 45m”). |
| ModeComposite (VYScore_\(\lambda\)) | 1–5 | \( \lambda V + (1-\lambda)Y \); \(\lambda\in\{0.8,0.6,0.4\}\) for Harvest/Balanced/Explore. |

**Reference set for ECDF**  
- Use same-metro rolling corpus if possible; otherwise, day-level or trip-level.  
- ECDF is preferred over linear min–max for robustness to outliers and heavy tails.

---

## 3) Affluence Join (ZIP/ZCTA)

| Field | Type | Notes |
|------|------|------|
| MedianIncome | number | ACS B19013 (estimate). |
| PctHH_100kPlus | number | Derived from ACS B19001 bins. |
| PctRenters | number | ACS B25003 renter share. |
| Population | number | ACS B01003 total population. |

**Normalized variants** (for modeling): min–max or z-score within metro.

---

## 4) Modeling Slots (for later calibration)

**Yield GLM (Poisson/NegBin):**  
- Response: \(N\), Offset: \(\log(t/45)\)  
- Predictors: type (intercepts), `Income_norm`, `Pct100k_norm`, `Renters_norm`, optional interactions.  

**Value Ordinal Model:**  
- Response: \(V\in\{1,2,3,4,5\}\)  
- Predictors: type (intercepts), same affluence set.

---

## 5) Integrity & Consistency

- **Time:** if \(t<30\) min, flag as low-confidence for Y (below MQA mark).  
- **Spend basis:** pick pre- or post-tax; add a `SpendBasis` sheet-level note and stay consistent.  
- **Observer effects:** keep `ObserverId` to enable future hierarchical modeling.  
- **Reproducibility:** retain both raw values and normalized forms; store ECDF reference window.

---

## 6) Minimal App Questionnaire (for later UI)

1) How long were you in the store? (minutes)  
2) How many items did you buy? (count)  
3) How good was the haul overall? (1–5)

**Optional:** total spend; short tag for what you found.


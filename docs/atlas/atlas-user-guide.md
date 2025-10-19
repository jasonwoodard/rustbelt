# docs/atlas/USER-GUIDE.md

# Atlas – User Guide (Plain Language)

Atlas helps you decide **where the good stores probably are** and **how to prioritize them** before you ever route the day.

- **Value (V):** how good the “haul” felt (1–5).
- **Yield (Y):** how fast you found buy-worthy items, adjusted for time (1–5).

You can keep V and Y separate, or press a button to combine them into one number for routing.

---

## What you give Atlas

- A CSV/JSON of **stores** (id, type, lat/lon, ZIP).  
- A CSV of **ZIP demographics** (median income, % renters, etc.).  
- Optional **visit notes** from the field (time in store, how many items you bought, how good the haul felt).

That’s it.

---

## What Atlas gives back

For each store, Atlas returns:
- **V (1–5):** predicted or observed haul quality  
- **Y (1–5):** predicted or observed efficiency (finds per 45 minutes)  
- **Credibility (0–1):** how confident the estimate is  
- **Why:** a short explanation (which signals drove the score)

You can sort by V, Y, or combine them (see “Modes” below).

---

## Modes you can run

- **Prior-Only:** You have no visits. Atlas uses neighborhood data (income, renter %) + store type to estimate V and Y.  
- **Posterior-Only:** You have visit notes. Atlas learns from them and predicts the rest.  
- **Blended:** You want both: observations matter most, but neighborhood still nudges.

---

## Minimal data to record after each store

Answer **three questions**:
1) **How long** did you stay? (minutes)  
2) **How many items** did you buy? (count)  
3) **How good was the haul** overall? (1–5)

Atlas converts that to V and Y automatically.

---

## How V and Y are used

- **V** is your haul quality (1–5).  
- **Y** is your rate: items per 45 minutes, mapped to 1–5 relative to the city/day.  
- To make a single number (for routing):  
  `VYScore_λ = λ·V + (1−λ)·Y`  
  - **Harvest (λ=0.8):** favor quality days (antiques, curated vintage)  
  - **Balanced (λ=0.6):** even  
  - **Explore (λ=0.4):** favor high-throughput thrift

---

## Typical workflow

1) Load stores + ZIP demographics → run **Prior-Only** → get a first ranked list.  
2) Visit a few stores; log time, items bought, and haul quality.  
3) Re-run Atlas in **Posterior-Only** → watch unvisited stores re-order.  
4) When ready, switch to **Blended** to mix in the ZIP context carefully.  
5) Send the single score to the Solver when you want a route.

---

## FAQ

**Do I have to combine V and Y?**  
No. Keep them separate for analysis. Only combine when the Solver needs one number.

**Is Google star rating used?**  
Not directly. It doesn’t predict discovery well. Your **visit notes** and the **neighborhood** do.

**Why ZIP and not census tract?**  
ZIP is good enough for driving-scale decisions. If you want finer resolution later, the math stays the same.

**What if two stores tie?**  
Use JScore (your curation prior) as a tie-breaker, or prefer higher-credibility estimates.

---

## What “credibility” means

Early on, estimates are noisier. Atlas attaches **Cred** (0–1) to each store so you can:
- Prioritize high-cred picks when the day matters,
- Keep an eye on low-cred stores for **exploration**.

---

## Where to learn the math

- V/Y definitions & mapping: `vy-whitepaper.md`  
- Data fields & formulas: `vy-data-dictionary.md`  
- Affluence priors: `rust-belt-atlas-affluence-model.md`


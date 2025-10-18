# Rust Belt Atlas → Solver User Journey Flow

Atlas and Solver are designed as **connected stages** in the Rust Belt project.  
Atlas builds the landscape; Solver builds the route.  
The user provides curation inputs between the two.

---

## High-Level Flow

1. **Accumulate Data**  
   - User maintains store database (IDs, types, lat/lon).  
   - User integrates affluence data (census, turnover, housing).  
   - Observations from prior trips logged (Value, Yield).

2. **Run Atlas**  
   - Atlas computes **Value–Yield scores** (desk priors + observations).  
   - Atlas identifies **metro anchors** (broad clusters) and **sub-clusters** (curated pockets).  
   - Atlas produces outputs: scored stores, anchors, clusters, diagnostics, and explanation traces.

3. **User Curation (Geo Curation Layer)**  
   - User selects **metropolitan areas/anchors** of interest.  
   - User can include/exclude clusters or specific stores.  
   - User defines day-level parameters:  
     - Start/end points  
     - Time windows  
     - Default dwell assumptions  
     - Must-visit stores  

4. **Run Solver**  
   - Solver consumes curated Atlas outputs.  
   - Generates optimal itineraries based on Value–Yield, anchor/cluster membership, and user parameters.  
   - Produces day-level route JSON/HTML (same format as current Solver).

5. **Day-of Use**  
   - User executes trip with Solver itineraries.  
   - Observations collected via MQA tool (Value–Yield, notes).  

6. **Feedback Loop**  
   - Observations feed back into Atlas dataset.  
   - Posterior Value–Yield scores updated.  
   - Anchors/clusters recomputed for future trips.  
   - Over time, desk priors get stronger and exploration vs exploitation balance improves.

---

## Diagram (Textual)
[Store Data + Affluence + Observations]
|
v
[Atlas Engine]
- Scores stores (V–Y)
- Identifies anchors
- Detects clusters
|
v
[User Geo Curation]
- Pick metros/clusters
- Set start/finish, time
|
v
[Solver Engine]
- Builds day itineraries
- Outputs JSON/HTML
|
v
[Trip Execution]
- Collect observations
- Update Atlas dataset


---

## Key Insight

- **Atlas = landscape map**: tells you what is promising and how stores group.  
- **User = navigator**: chooses where to play (metros, clusters, day params).  
- **Solver = pathfinder**: orders chosen stores into optimal routes.  
- **Observations = feedback**: make the whole system smarter over time.

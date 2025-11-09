/*
1) STORES: Imports store data from import/rb-stores.csv and inserts it into
stores table.

If there is a store_id, e.g 'WSAM', conflict it does an UPSERT on the store
row.  This will nominally allow for changes made in the sheet then exported
to CSV to included.  This hasn't been confirmed to 'just work' yet so use 
caution.
*/

-- STORES
-- Clear the slate for a fresh import
DROP TABLE IF EXISTS temp_stores;

-- Create the temp table
CREATE TABLE IF NOT EXISTS temp_stores (
    store_id TEXT,
    auto_ids TEXT,
    store_type TEXT,
    store_name TEXT,
    address TEXT,
    google_name TEXT,
    gscore TEXT,
    grev_count TEXT,
    jscore TEXT,
    tier TEXT,
    must_visit TEXT,
    day TEXT,
    store_note TEXT,
    store_lat TEXT,
    store_lon TEXT,
    live_census_lat TEXT,
    live_census_lon TEXT,
    store_pk TEXT,
    google_url TEXT
);

-- Do the import
.import --skip 1 import/rb-stores.csv temp_stores

-- UPSERT the imported data into the stores table.
INSERT INTO
    stores (
        store_id,
        store_name,
        store_type,
        address,
        city,
        state,
        zip,
        lat,
        lon,
        jscore_prior,
        store_note,
        google_url,
        updated_at
    )
SELECT
    store_id,
    store_name,
    store_type,
    
    SUBSTR(address, 1,INSTR(address, ',') - 1), -- Address
    SUBSTR(address,
        INSTR(address, ',') + 2,
        INSTR(SUBSTR(address, INSTR(address, ',') + 1),',') - 2), --City
    SUBSTR(address, -8, 2), -- State
    SUBSTR(address, -5), -- Zip
    
    CAST(store_lat as REAL),
    CAST(store_lon as REAL),
    CAST(jscore as REAL),
    store_note,
    google_url,
    datetime('now')
FROM temp_stores
WHERE
    true --NEEDED to resolve parsing ambiguity 
ON CONFLICT (store_id) DO
UPDATE
SET
    store_name = excluded.store_name,
    store_type = excluded.store_type,
    address = excluded.address,
    lat = excluded.lat,
    lon = excluded.lon,
    jscore_prior = excluded.jscore_prior,
    store_note = excluded.store_note,
    google_url = excluded.google_url,
    updated_at = datetime('now');


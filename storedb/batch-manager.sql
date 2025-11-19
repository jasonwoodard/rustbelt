-- Table to manage persistent groups or batches of stores
CREATE TABLE IF NOT EXISTS store_batches (
    store_id TEXT NOT NULL,         -- Links to stores.store_id
    batch_name TEXT NOT NULL,       -- The name of your group (e.g., 'VogueVint's Batch')
    created_at DATETIME NOT NULL,   -- When the store was added to the batch
    
    PRIMARY KEY (store_id, batch_name),
    
    -- Optional: Foreign key constraint to ensure the store exists
    FOREIGN KEY (store_id) REFERENCES stores(store_id)
);

-- Build the Detroit Batch
INSERT INTO store_batches (store_id, batch_name, created_at) VALUES
('RWBT', 'Detroit-Set', datetime('now')),
('TWL', 'Detroit-Set', datetime('now')),
('VWT-Eastpointe', 'Detroit-Set', datetime('now')),
('VWT-Warren', 'Detroit-Set', datetime('now')),
('VogueVint', 'Detroit-Set', datetime('now')),
('VWT-OakPark', 'Detroit-Set', datetime('now')),
('VWT-Southfield', 'Detroit-Set', datetime('now')),
('VMDV', 'Detroit-Set', datetime('now')),
('VWT-Taylor', 'Detroit-Set', datetime('now')),
('MCAG', 'Detroit-Set', datetime('now')),
('VWT-Southgate', 'Detroit-Set', datetime('now')),
('FV', 'Detroit-Set', datetime('now')),
('TSAFS6', 'Detroit-Set', datetime('now')),
('VWT-ClinTown', 'Detroit-Set', datetime('now'));

INSERT INTO store_batches (store_id, batch_name, created_at) VALUES
('TS', 'AnnArbor-Set', datetime('now')),
('SCR', 'AnnArbor-Set', datetime('now')),
('TSAFSCT', 'AnnArbor-Set', datetime('now')),
('TPCAA', 'AnnArbor-Set', datetime('now')),
('RAGS', 'AnnArbor-Set', datetime('now')),
('VWT9', 'AnnArbor-Set', datetime('now')),
('VWT-Westland', 'AnnArbor-Set', datetime('now')),
('TSAFS', 'AnnArbor-Set', datetime('now')),
('AATS', 'AnnArbor-Set', datetime('now')),
('TBIN', 'AnnArbor-Set', datetime('now'));

INSERT INTO store_batches (store_id, batch_name, created_at) VALUES
('AVM', 'Cleveland-Set', datetime('now')),
('BSS', 'Cleveland-Set', datetime('now')),
('SL', 'Cleveland-Set', datetime('now')),
('TVAT', 'Cleveland-Set', datetime('now')),
('TCKA', 'Cleveland-Set', datetime('now')),
('VWT-Lakewood', 'Cleveland-Set', datetime('now')),
('VWT-Olmstead', 'Cleveland-Set', datetime('now')),
('PG', 'Cleveland-Set', datetime('now'));

INSERT INTO store_batches (store_id, batch_name, created_at) VALUES
('SBTL', 'Buffalo-Set', datetime('now')),
('SAVERSB', 'Buffalo-Set', datetime('now')),
('FSW', 'Buffalo-Set', datetime('now')),
('AU', 'Buffalo-Set', datetime('now')),
('RRAC', 'Buffalo-Set', datetime('now'));

INSERT INTO store_batches (store_id, batch_name, created_at) VALUES
('SAVERST', 'Catskills-Set', datetime('now')),
('AWFM', 'Catskills-Set', datetime('now')),
('AB', 'Catskills-Set', datetime('now')),
('GJE', 'Catskills-Set', datetime('now')),
('ATSWS', 'Catskills-Set', datetime('now')),
('HTSHFB', 'Catskills-Set', datetime('now')),
('SAVERSR', 'Catskills-Set', datetime('now'));
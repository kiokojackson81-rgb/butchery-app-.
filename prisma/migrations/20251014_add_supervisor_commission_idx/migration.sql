-- Add index for SupervisorCommission outletName,date to speed recompute scans
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS supervisorcommission_outlet_date_idx ON "SupervisorCommission" ("outletName", "date");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
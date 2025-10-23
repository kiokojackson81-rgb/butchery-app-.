SELECT migration_name, finished_at, applied_steps_count, logs
FROM "_prisma_migrations"
ORDER BY finished_at DESC
LIMIT 50;

SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND (tablename ILIKE '%supervisor%' OR tablename ILIKE '%commission%') ORDER BY tablename;

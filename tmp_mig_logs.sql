SELECT migration_name, finished_at, applied_steps_count, logs
FROM "_prisma_migrations"
WHERE migration_name LIKE '20251013_add_supervisor_commission%'
ORDER BY finished_at DESC
LIMIT 10;

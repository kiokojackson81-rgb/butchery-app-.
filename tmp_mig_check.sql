SELECT id, migration_name, finished_at, logs, rolled_back_at, status FROM prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 20;

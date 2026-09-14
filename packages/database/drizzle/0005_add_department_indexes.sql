CREATE INDEX IF NOT EXISTS "idx_projects_department" ON "projects" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_department" ON "tasks" USING btree ("department_id");--> statement-breakpoint
-- Backfill tasks.department_id for the isolation wall. Precedence per spec:
-- assignee's dept -> team's dept -> creator's dept. Only touch NULL rows so the
-- migration is idempotent and never overwrites an explicitly-set department.
UPDATE "tasks" t SET "department_id" = COALESCE(
  (SELECT au."department_id" FROM "users" au WHERE au."id" = t."assigned_to"),
  (SELECT tm."department_id" FROM "teams" tm WHERE tm."id" = t."team_id"),
  (SELECT cu."department_id" FROM "users" cu WHERE cu."id" = t."created_by")
)
WHERE t."department_id" IS NULL;

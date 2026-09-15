ALTER TABLE "leave_requests" ALTER COLUMN "days_count" SET DATA TYPE numeric(5, 1);--> statement-breakpoint
ALTER TABLE "leave_balances" ALTER COLUMN "allocated_days" SET DATA TYPE numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_balances" ALTER COLUMN "used_days" SET DATA TYPE numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_balances" ALTER COLUMN "pending_days" SET DATA TYPE numeric(6, 1);

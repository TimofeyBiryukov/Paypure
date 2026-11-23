-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('invited', 'active', 'deactivated');

-- CreateEnum
CREATE TYPE "NumberReset" AS ENUM ('never', 'yearly');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('hourly', 'fixed', 'non_billable');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'completed');

-- CreateEnum
CREATE TYPE "BudgetKind" AS ENUM ('hours', 'money');

-- CreateEnum
CREATE TYPE "TimeEntryState" AS ENUM ('running', 'paused', 'stopped');

-- CreateEnum
CREATE TYPE "OffInvoiceKind" AS ENUM ('billed_elsewhere', 'written_off');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'void');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('paypure', 'paydirt');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('time', 'fixed', 'manual', 'discount');

-- CreateEnum
CREATE TYPE "PaymentAccountMode" AS ENUM ('default', 'account', 'none');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('payment', 'refund');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('queued', 'waiting_for_pdf', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('invoice', 'correction', 'reminder', 'thank_you', 'test', 'invite', 'password_reset');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "default_rate_minor" INTEGER,
    "default_terms_days" INTEGER NOT NULL DEFAULT 14,
    "number_format" TEXT NOT NULL DEFAULT 'INV-{YYYY}-{seq:4}',
    "number_reset" "NumberReset" NOT NULL DEFAULT 'yearly',
    "default_notes" TEXT NOT NULL DEFAULT '',
    "ready_threshold_minor" INTEGER NOT NULL DEFAULT 100000,
    "business_name" TEXT NOT NULL DEFAULT '',
    "sender_name" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "tax_id" TEXT NOT NULL DEFAULT '',
    "billing_email" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_default_taxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_default_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "status" "MemberStatus" NOT NULL DEFAULT 'invited',
    "password_hash" TEXT,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "time_format" TEXT NOT NULL DEFAULT '24h',
    "week_start" INTEGER NOT NULL DEFAULT 1,
    "invite_token_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL DEFAULT '',
    "billing_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "address" TEXT NOT NULL DEFAULT '',
    "tax_id" TEXT NOT NULL DEFAULT '',
    "currency" CHAR(3) NOT NULL,
    "rate_minor" INTEGER,
    "terms_days" INTEGER,
    "colour" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "line_layout" JSONB,
    "ready_threshold_minor" INTEGER,
    "default_payment_account_id" UUID,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_minor" INTEGER,
    "budget_kind" "BudgetKind",
    "budget_value" INTEGER,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "billing_mode" "BillingMode" NOT NULL DEFAULT 'hourly',
    "rate_minor" INTEGER,
    "fixed_amount_minor" INTEGER,
    "estimate_seconds" INTEGER,
    "done_at" TIMESTAMPTZ,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "task_id" UUID,
    "state" "TimeEntryState" NOT NULL DEFAULT 'stopped',
    "time_zone" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "billable" BOOLEAN NOT NULL,
    "invoice_id" UUID,
    "off_invoice" "OffInvoiceKind",
    "off_invoice_ref" TEXT,
    "off_invoice_note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry_segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "time_entry_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "label" TEXT NOT NULL,
    "beneficiary_name" TEXT NOT NULL DEFAULT '',
    "beneficiary_address" TEXT NOT NULL DEFAULT '',
    "bank_name" TEXT NOT NULL DEFAULT '',
    "bank_address" TEXT NOT NULL DEFAULT '',
    "account_number" TEXT,
    "iban" TEXT,
    "swift_bic" TEXT,
    "routing_number" TEXT,
    "correspondent_bank_name" TEXT,
    "correspondent_account" TEXT,
    "correspondent_swift" TEXT,
    "reference_hint" TEXT,
    "instructions" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "workspace_id" UUID NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "next_seq" INTEGER NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("workspace_id","period")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "number" TEXT,
    "number_seq" INTEGER,
    "number_period" TEXT,
    "currency" CHAR(3) NOT NULL,
    "current_version_id" UUID,
    "public_token" TEXT NOT NULL,
    "source" "InvoiceSource" NOT NULL DEFAULT 'paypure',
    "voided_at" TIMESTAMPTZ,
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "rev" INTEGER NOT NULL,
    "frozen_at" TIMESTAMPTZ,
    "frozen_by" UUID,
    "issue_date" DATE,
    "due_date" DATE,
    "due_date_manual" BOOLEAN NOT NULL DEFAULT false,
    "terms_days" INTEGER NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "from_snapshot" JSONB,
    "to_snapshot" JSONB,
    "payment_account_mode" "PaymentAccountMode" NOT NULL DEFAULT 'default',
    "payment_account_id" UUID,
    "payment_account_snapshot" JSONB,
    "line_layout" JSONB NOT NULL,
    "subtotal" INTEGER,
    "discount_total" INTEGER,
    "tax_total" INTEGER,
    "total" INTEGER,
    "change_summary" TEXT,
    "content_hash" TEXT,
    "template_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "qty_hundredths" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "rate_minor" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "discount_rate_bp" INTEGER,
    "task_id" UUID,
    "overrides" JSONB NOT NULL DEFAULT '[]',
    "source_fingerprint" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_version_taxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_version_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_taxes" (
    "line_id" UUID NOT NULL,
    "version_tax_id" UUID NOT NULL,

    CONSTRAINT "invoice_line_taxes_pkey" PRIMARY KEY ("line_id","version_tax_id")
);

-- CreateTable
CREATE TABLE "invoice_line_entries" (
    "line_id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "seconds" INTEGER NOT NULL,

    CONSTRAINT "invoice_line_entries_pkey" PRIMARY KEY ("line_id","time_entry_id")
);

-- CreateTable
CREATE TABLE "invoice_entry_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "op" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "segments" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_entry_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_files" (
    "version_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'rendered',
    "pdf" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "template_version" TEXT NOT NULL,
    "rendered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_files_pkey" PRIMARY KEY ("version_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'payment',
    "amount" INTEGER NOT NULL,
    "received_on" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'bank_transfer',
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "version_id" UUID,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actor_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "invoice_id" UUID,
    "version_id" UUID,
    "kind" "EmailKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "reply_to" TEXT NOT NULL DEFAULT '',
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "EmailStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "transport" TEXT,
    "message_id" TEXT,
    "queued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "created_by" UUID,

    CONSTRAINT "outbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_workspace_id_kind_key" ON "email_templates"("workspace_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "members_invite_token_hash_key" ON "members"("invite_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "members_workspace_id_email_key" ON "members"("workspace_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "clients_workspace_id_idx" ON "clients"("workspace_id");

-- CreateIndex
CREATE INDEX "projects_workspace_id_client_id_idx" ON "projects"("workspace_id", "client_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_project_id_idx" ON "tasks"("workspace_id", "project_id");

-- CreateIndex
CREATE INDEX "time_entries_workspace_id_member_id_date_idx" ON "time_entries"("workspace_id", "member_id", "date");

-- CreateIndex
CREATE INDEX "time_entry_segments_time_entry_id_idx" ON "time_entry_segments"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_current_version_id_key" ON "invoices"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_public_token_key" ON "invoices"("public_token");

-- CreateIndex
CREATE INDEX "invoices_workspace_id_status_idx" ON "invoices"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspace_id_number_key" ON "invoices"("workspace_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspace_id_number_period_number_seq_key" ON "invoices"("workspace_id", "number_period", "number_seq");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_versions_invoice_id_rev_key" ON "invoice_versions"("invoice_id", "rev");

-- CreateIndex
CREATE INDEX "invoice_lines_version_id_idx" ON "invoice_lines"("version_id");

-- CreateIndex
CREATE INDEX "invoice_line_entries_time_entry_id_idx" ON "invoice_line_entries"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_entry_changes_version_id_time_entry_id_key" ON "invoice_entry_changes"("version_id", "time_entry_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_activity_invoice_id_at_idx" ON "invoice_activity"("invoice_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_emails_idempotency_key_key" ON "outbound_emails"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbound_emails_status_idx" ON "outbound_emails"("status");

-- AddForeignKey
ALTER TABLE "workspace_default_taxes" ADD CONSTRAINT "workspace_default_taxes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_default_payment_account_id_fkey" FOREIGN KEY ("default_payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_segments" ADD CONSTRAINT "time_entry_segments_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "invoice_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "invoice_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_version_taxes" ADD CONSTRAINT "invoice_version_taxes_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "invoice_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_taxes" ADD CONSTRAINT "invoice_line_taxes_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_taxes" ADD CONSTRAINT "invoice_line_taxes_version_tax_id_fkey" FOREIGN KEY ("version_tax_id") REFERENCES "invoice_version_taxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_entries" ADD CONSTRAINT "invoice_line_entries_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_entries" ADD CONSTRAINT "invoice_line_entries_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_entry_changes" ADD CONSTRAINT "invoice_entry_changes_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "invoice_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_entry_changes" ADD CONSTRAINT "invoice_entry_changes_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_files" ADD CONSTRAINT "invoice_files_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "invoice_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activity" ADD CONSTRAINT "invoice_activity_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


import { Injectable } from "@nestjs/common";
import {
  displayStatus,
  lineAmount,
  type RateSource,
  resolveRate,
  secondsToHundredths,
  todayIn,
  unbilledFixed,
} from "@paypure/domain";
import { d2s } from "../common/dates";
import type { Workspace } from "../generated/prisma/client";
import { Prisma, PrismaService, type Tx } from "../prisma.service";

export interface TaskUnbilled {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  clientId: string;
  currency: string;
  mode: "hourly" | "fixed" | "non_billable";
  /** hourly unbilled seconds (07 §10) */
  seconds: number;
  since: string | null;
  rateMinor: number | null;
  rateSource: RateSource | null;
  /** hourly value, as if the task were one line (07 §6) */
  hourlyMinor: number | null;
  feeMinor: number | null;
  fixedBilledMinor: number;
  fixedRemainingMinor: number;
  taskCreated: string;
}

/** Shared money queries: "unbilled" is defined once (07 §10), billed fixed fees per 07 §4.2. */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async fixedBilled(
    db: Tx | PrismaService,
    wsId: string,
    excludeInvoiceId?: string,
  ): Promise<Map<string, number>> {
    const rows = await db.$queryRaw<{ task_id: string; billed: number }[]>`
      WITH per AS (
        SELECT l.task_id, i.id AS inv,
          SUM(CASE WHEN v.id = i.current_version_id THEN l.amount_minor ELSE 0 END) AS cur,
          SUM(CASE WHEN v.frozen_at IS NULL THEN l.amount_minor ELSE 0 END) AS open
        FROM invoice_lines l
        JOIN invoice_versions v ON v.id = l.version_id
        JOIN invoices i ON i.id = v.invoice_id
        WHERE l.kind = 'fixed' AND i.status <> 'void' AND i.workspace_id = ${wsId}::uuid
          AND (${excludeInvoiceId ?? null}::uuid IS NULL OR i.id <> ${excludeInvoiceId ?? null}::uuid)
        GROUP BY l.task_id, i.id)
      SELECT task_id, SUM(GREATEST(cur, open))::int AS billed FROM per GROUP BY task_id`;
    return new Map(rows.map((r) => [r.task_id, r.billed]));
  }

  async unbilledTasks(
    ws: Workspace,
    filter: { clientId?: string; projectId?: string; includeArchived?: boolean } = {},
  ): Promise<TaskUnbilled[]> {
    const rows = await this.prisma.$queryRaw<
      {
        task_id: string;
        task_name: string;
        project_id: string;
        project_name: string;
        client_id: string;
        currency: string;
        billing_mode: "hourly" | "fixed" | "non_billable";
        task_rate: number | null;
        project_rate: number | null;
        client_rate: number | null;
        fixed_amount_minor: number | null;
        seconds: number;
        since: Date | null;
        task_created: Date;
      }[]
    >`
      SELECT t.id AS task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name,
             c.id AS client_id, c.currency, t.billing_mode, t.rate_minor AS task_rate,
             p.rate_minor AS project_rate, c.rate_minor AS client_rate, t.fixed_amount_minor,
             COALESCE(SUM(te.duration_seconds) FILTER (WHERE te.id IS NOT NULL), 0)::int AS seconds,
             MIN(te.date) AS since, t.created_at AS task_created
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      JOIN clients c ON c.id = p.client_id
      LEFT JOIN time_entries te ON te.task_id = t.id
        AND te.invoice_id IS NULL AND te.off_invoice IS NULL AND te.billable
        AND te.state = 'stopped' AND te.deleted_at IS NULL AND t.billing_mode = 'hourly'
      WHERE t.workspace_id = ${ws.id}::uuid
        AND (${filter.clientId ?? null}::uuid IS NULL OR c.id = ${filter.clientId ?? null}::uuid)
        AND (${filter.projectId ?? null}::uuid IS NULL OR p.id = ${filter.projectId ?? null}::uuid)
        AND (${filter.includeArchived ?? false} OR c.archived_at IS NULL)
      GROUP BY t.id, p.id, c.id`;
    const fixedBilled = await this.fixedBilled(this.prisma, ws.id);
    return rows.map((r) => {
      const resolved =
        r.billing_mode === "hourly"
          ? resolveRate({
              taskRateMinor: r.task_rate,
              projectRateMinor: r.project_rate,
              clientRateMinor: r.client_rate,
              clientCurrency: r.currency,
              workspaceRateMinor: ws.defaultRateMinor,
              workspaceCurrency: ws.currency,
            })
          : null;
      const billed = fixedBilled.get(r.task_id) ?? 0;
      return {
        taskId: r.task_id,
        taskName: r.task_name,
        projectId: r.project_id,
        projectName: r.project_name,
        clientId: r.client_id,
        currency: r.currency,
        mode: r.billing_mode,
        seconds: r.seconds,
        since: d2s(r.since),
        rateMinor: resolved?.rateMinor ?? null,
        rateSource: resolved?.source ?? null,
        hourlyMinor:
          resolved && r.seconds > 0
            ? lineAmount(secondsToHundredths(r.seconds), resolved.rateMinor)
            : r.seconds > 0
              ? null
              : 0,
        feeMinor: r.fixed_amount_minor,
        fixedBilledMinor: billed,
        fixedRemainingMinor:
          r.billing_mode === "fixed" && r.fixed_amount_minor
            ? unbilledFixed(r.fixed_amount_minor, billed)
            : 0,
        taskCreated: d2s(r.task_created) ?? "",
      };
    });
  }

  /** Per-client rollup for Home's "Ready to invoice" and the client list. */
  rollupByClient(tasks: TaskUnbilled[]) {
    const map = new Map<
      string,
      {
        clientId: string;
        currency: string;
        seconds: number;
        amountMinor: number;
        noRateSeconds: number;
        since: string | null;
      }
    >();
    for (const t of tasks) {
      const amount = (t.hourlyMinor ?? 0) + t.fixedRemainingMinor;
      if (t.seconds === 0 && t.fixedRemainingMinor === 0) continue;
      const cur = map.get(t.clientId) ?? {
        clientId: t.clientId,
        currency: t.currency,
        seconds: 0,
        amountMinor: 0,
        noRateSeconds: 0,
        since: null as string | null,
      };
      cur.seconds += t.seconds;
      cur.amountMinor += amount;
      if (t.mode === "hourly" && t.rateMinor == null) cur.noRateSeconds += t.seconds;
      const since = t.mode === "fixed" && t.fixedRemainingMinor > 0 ? t.taskCreated : t.since;
      if (since && (!cur.since || since < cur.since)) cur.since = since;
      map.set(t.clientId, cur);
    }
    return map;
  }

  /** Invoice summaries with derived status (08 §2.1). */
  async invoiceSummaries(ws: Workspace, where: Prisma.InvoiceWhereInput = {}) {
    const invoices = await this.prisma.invoice.findMany({
      where: { workspaceId: ws.id, ...where },
      include: {
        client: { select: { id: true, name: true, colour: true } },
        currentVersion: { select: { rev: true, issueDate: true, dueDate: true, total: true } },
        versions: {
          where: { frozenAt: null },
          select: { id: true, rev: true, total: true, dueDate: true },
        },
        payments: {
          where: { deletedAt: null },
          select: { kind: true, amount: true, receivedOn: true },
        },
        activity: { where: { kind: "viewed" }, select: { id: true }, take: 1 },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    const today = todayIn(ws.timeZone);
    return invoices.map((i) => {
      const open = i.versions[0];
      const cur = i.currentVersion;
      const totalMinor = (i.status === "draft" ? open?.total : cur?.total) ?? 0;
      const netPaidMinor = i.payments.reduce(
        (s, p) => s + (p.kind === "payment" ? p.amount : -p.amount),
        0,
      );
      const dueDate = d2s(i.status === "draft" ? open?.dueDate : cur?.dueDate);
      const st = displayStatus({ status: i.status, totalMinor, netPaidMinor, dueDate, today });
      const lastPaid = i.payments.reduce<string | null>((m, p) => {
        const d = d2s(p.receivedOn);
        return d && (!m || d > m) ? d : m;
      }, null);
      return {
        id: i.id,
        number: i.number,
        status: i.status,
        source: i.source,
        rev: cur?.rev ?? 1,
        correctionOpen: i.status === "issued" && !!open,
        client: i.client,
        currency: i.currency,
        issueDate: d2s(cur?.issueDate),
        dueDate,
        totalMinor,
        netPaidMinor,
        balanceMinor: st.balanceMinor,
        display: st,
        viewed: i.activity.length > 0,
        lastPaidOn: lastPaid,
        createdAt: i.createdAt.toISOString(),
      };
    });
  }
}

export { Prisma };

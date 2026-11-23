import { type ChipTone, daysBetween, formatDateLong, formatMoney, type SheetData, todayIn } from "@paypure/domain";
import { FileDown } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  addInvoiceNote,
  correctInvoice,
  deleteDraft,
  discardCorrection,
  duplicateInvoiceAction,
  markSent,
  refreshDetails,
  regenerateLink,
  removePayment,
  retryEmail,
  saveCorrectionWithoutSending,
  updateLines,
} from "@/app/actions/invoices";
import { CopyButton } from "@/components/copy-button";
import { DraftEditor, type OpenVersion } from "@/components/draft-editor";
import { type EmailPreview, PaymentForm, SendForm, VoidForm } from "@/components/invoice-dialogs";
import { InvoiceSheet } from "@/components/sheet";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/toaster";
import { ClientBadge, PageHeader, StatusChip } from "@/components/ui";
import { UrlDialog } from "@/components/url-dialog";
import { api, ApiError, getMe } from "@/server/api";

export const metadata = { title: "Invoice" };

interface Inv {
  id: string;
  number: string | null;
  status: "draft" | "issued" | "void";
  source: "paypure" | "paydirt";
  currency: string;
  publicUrl: string;
  client: { id: string; name: string; colour: number; billingEmails: string[] };
  display: { key: string; label: string; tone: ChipTone; balanceMinor: number; overpaidMinor?: number; overdueDays?: number };
  totalMinor: number;
  netPaidMinor: number;
  claimedEntries: number;
  currentVersion: { id: string; rev: number; sheet: SheetData; changeSummary: string | null } | null;
  open: (OpenVersion & { staged: { entryId: string; op: string; changes: Record<string, [unknown, unknown]>; taskName: string; date: string | null }[] }) | null;
  versions: { id: string; rev: number; frozenAt: string; changeSummary: string | null; total: number }[];
  payments: { id: string; kind: "payment" | "refund"; amountMinor: number; receivedOn: string; method: string; note: string; deleted: boolean }[];
  activity: { id: string; kind: string; actor: string; data: Record<string, unknown>; at: string }[];
  emails: { id: string; kind: string; to: string[]; cc: string[]; subject: string; textBody: string; status: string; attempts: number; lastError: string | null; attachments: { name: string; bytes: number; sha256: string }[]; queuedAt: string; sentAt: string | null }[];
  accounts: { id: string; label: string; bankName: string; last4: string; isDefault: boolean }[];
  canVoid: boolean;
}

const ACTIVITY: Record<string, string> = {
  created: "Created",
  sent: "Sent",
  marked_sent: "Marked as sent",
  resent: "Sent again",
  reminded: "Reminder sent",
  correction_opened: "Correction opened",
  correction_sent: "Correction sent",
  correction_saved: "Correction saved without sending",
  correction_discarded: "Correction discarded",
  payment_recorded: "Payment recorded",
  refund_recorded: "Refund recorded",
  payment_removed: "Payment removed",
  payment_restored: "Payment restored",
  paid: "Paid in full",
  voided: "Voided",
  viewed: "Viewed by client",
  thanked: "Thank-you sent",
  email_failed: "Email failed",
  link_regenerated: "Public link regenerated",
  note: "Note",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Invoice (S11): one route, edit mode for drafts and corrections, view mode once sent. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ send?: string; pay?: string; void?: string; copied?: string; email?: string }> }) {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  let inv: Inv;
  try {
    inv = await api<Inv>(`/v1/invoices/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const today = todayIn(me.workspace.timeZone);
  const m = (n: number) => formatMoney({ minor: n, currency: inv.currency });
  const sendKind = sp.send === "correction" || sp.send === "reminder" || sp.send === "invoice" ? sp.send : null;
  const preview = sendKind ? await api<EmailPreview>(`/v1/invoices/${id}/email?kind=${sendKind}`) : null;
  const isDraft = inv.status === "draft";
  const correction = inv.status === "issued" && inv.open;
  const title = inv.number ?? `Draft · ${inv.client.name}`;
  const outdated = inv.open?.lines.filter((l) => l.outdated).length ?? 0;
  const balance = inv.display.balanceMinor;
  const prefilled = correction && inv.currentVersion ? `Total ${m(inv.currentVersion.sheet.totalMinor)} → ${m(inv.open?.sheet.totalMinor ?? 0)}` : "";
  const hidden = <input type="hidden" name="invoiceId" value={inv.id} />;

  const primary = isDraft ? (
    <Link href={`?send=invoice`} scroll={false} className="btn btn-primary">
      Send invoice
    </Link>
  ) : correction ? (
    <Link href={`?send=correction`} scroll={false} className="btn btn-primary">
      Send correction
    </Link>
  ) : inv.status === "void" ? (
    <ActionForm action={duplicateInvoiceAction}>
      {hidden}
      <Submit>Duplicate</Submit>
    </ActionForm>
  ) : inv.display.key === "overdue" ? (
    <Link href="?send=reminder" scroll={false} className="btn btn-primary">
      Send reminder
    </Link>
  ) : inv.display.key !== "paid" ? (
    <Link href="?pay=1" scroll={false} className="btn btn-primary">
      Record payment
    </Link>
  ) : null;

  return (
    <div>
      <PageHeader
        crumbs={[{ href: "/invoices", label: "Invoices" }]}
        title={<span className={inv.status === "void" ? "line-through text-muted" : ""}>{title}</span>}
        chip={
          <>
            <StatusChip label={inv.display.label} tone={inv.display.tone} note={inv.display.overpaidMinor ? `overpaid ${m(inv.display.overpaidMinor)}` : undefined} />
            {(inv.currentVersion?.rev ?? 1) > 1 && <span className="t-caption">rev {inv.currentVersion?.rev}</span>}
          </>
        }
        sub={
          <Link href={`/clients/${inv.client.id}`} className="inline-flex items-center gap-2 hover:text-ink">
            <ClientBadge name={inv.client.name} colour={inv.client.colour} size={20} /> {inv.client.name}
          </Link>
        }
        actions={
          <>
            {!isDraft && (
              <>
                <a href={`/invoices/${inv.id}/pdf`} className="btn btn-secondary" target="_blank" rel="noreferrer">
                  <FileDown size={14} /> PDF
                </a>
                <CopyButton text={inv.publicUrl} label="Copy link" />
              </>
            )}
            {inv.display.key === "overdue" && !correction && (
              <Link href="?pay=1" scroll={false} className="btn btn-secondary">
                Record payment
              </Link>
            )}
            <details className="menu relative">
              <summary className="btn btn-secondary" aria-label="More actions">
                ⋯
              </summary>
              <div className="menu-body pop right-0 mt-2">
                {isDraft && (
                  <ActionForm action={markSent}>
                    {hidden}
                    <button type="submit" className="menu-item">
                      Mark as sent
                    </button>
                  </ActionForm>
                )}
                {inv.status === "issued" && !correction && (
                  <>
                    <Link href="?send=invoice" className="menu-item" scroll={false}>
                      Resend
                    </Link>
                    <Link href="?send=reminder" className="menu-item" scroll={false}>
                      Send reminder
                    </Link>
                    <Link href="?pay=refund" className="menu-item" scroll={false}>
                      Record refund
                    </Link>
                    {inv.source === "paypure" && (
                      <ActionForm action={correctInvoice}>
                        {hidden}
                        <button type="submit" className="menu-item">
                          Correct invoice
                        </button>
                      </ActionForm>
                    )}
                  </>
                )}
                <ActionForm action={duplicateInvoiceAction}>
                  {hidden}
                  <button type="submit" className="menu-item">
                    Duplicate
                  </button>
                </ActionForm>
                {!isDraft && (
                  <Link href={`/time?view=list&invoice=${inv.id}&member=all&from=2000-01-01`} className="menu-item">
                    View billed time
                  </Link>
                )}
                {!isDraft && (
                  <ActionForm action={regenerateLink}>
                    {hidden}
                    <button type="submit" className="menu-item">
                      Regenerate public link
                    </button>
                  </ActionForm>
                )}
                {inv.status === "issued" &&
                  (inv.canVoid ? (
                    <Link href="?void=1" className="menu-item danger" scroll={false}>
                      Void…
                    </Link>
                  ) : (
                    <span className="menu-item text-faint" title="Refund or remove the payments first, or correct the invoice instead.">
                      Void… (has payments)
                    </span>
                  ))}
                {isDraft && (
                  <ActionForm action={deleteDraft}>
                    {hidden}
                    <button type="submit" className="menu-item danger">
                      Delete draft
                    </button>
                  </ActionForm>
                )}
              </div>
            </details>
            {primary}
          </>
        }
      />

      {sp.copied && isDraft && <div className="banner mb-4 text-sm">Copied as fixed lines. Remove them and add unbilled time from the builder if this should bill tracked time.</div>}
      {inv.status === "void" && <div className="banner banner-danger mb-4 text-sm">This invoice was voided. Its number stays in your sequence.</div>}
      {inv.status === "issued" && !correction && (
        <div className="banner mb-4 text-sm">
          <span>Sent invoices can't be edited.</span>
          {inv.source === "paypure" && (
            <ActionForm action={correctInvoice} className="ml-auto">
              {hidden}
              <Submit className="btn btn-secondary btn-sm">Correct invoice</Submit>
            </ActionForm>
          )}
        </div>
      )}

      {correction && inv.open && (
        <div className="card p-4 mb-4 space-y-3 border-[var(--warning-fg)]">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="t-title-3">
              Correction to {inv.number} · revision {inv.open.rev}
            </h2>
            <ActionForm action={refreshDetails} className="ml-auto">
              {hidden}
              <Submit className="btn btn-ghost btn-sm">Refresh client, business and payment details</Submit>
            </ActionForm>
          </div>
          {inv.open.staged.length > 0 && (
            <div>
              <p className="font-medium">
                {inv.open.staged.length} {inv.open.staged.length === 1 ? "change" : "changes"} pending from billed time
              </p>
              <ul className="text-sm text-muted list-disc pl-5">
                {inv.open.staged.map((s) => (
                  <li key={s.entryId}>
                    {s.date} · {s.taskName}: {Object.keys(s.changes).join(", ")} {s.op === "move" ? "(moved)" : ""}
                  </li>
                ))}
              </ul>
              <p className="t-caption">Staged changes are applied to the time entries when you approve this correction.</p>
            </div>
          )}
          <ActionForm action={saveCorrectionWithoutSending} className="flex flex-col sm:flex-row gap-2 sm:items-end">
            {hidden}
            <div className="flex-1">
              <label className="label" htmlFor="cs">
                What changed (required)
              </label>
              <input id="cs" name="changeSummary" className="input" required defaultValue={prefilled} />
            </div>
            <Submit className="btn btn-secondary">Save without sending</Submit>
          </ActionForm>
          <ActionForm action={discardCorrection}>
            {hidden}
            <Submit className="btn btn-ghost btn-sm text-danger">Discard correction</Submit>
          </ActionForm>
        </div>
      )}

      {outdated > 0 && inv.open && (
        <ActionForm action={updateLines} className="banner banner-warning mb-4 text-sm">
          {hidden}
          <span>
            {outdated} {outdated === 1 ? "line" : "lines"} out of date (the time or rates changed).
          </span>
          <Submit className="btn btn-secondary btn-sm ml-auto">Update</Submit>
        </ActionForm>
      )}

      {inv.open ? (
        <DraftEditor
          // Remount only when the server changed the lines (Update, time claimed or released), never
          // after our own autosave: the save response already hands back the new ids.
          key={`${inv.open.id}:${inv.open.lines.filter((l) => l.outdated).map((l) => l.id).join(",")}:${inv.open.lines.reduce((s, l) => s + l.entryCount, 0)}`}
          invoiceId={inv.id}
          currency={inv.currency}
          open={inv.open}
          accounts={inv.accounts}
          today={today}
          current={inv.currentVersion?.sheet ?? null}
          netPaidMinor={inv.netPaidMinor}
        />
      ) : (
        <div className="grid xl:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="overflow-x-auto">{inv.currentVersion && <InvoiceSheet s={inv.currentVersion.sheet} />}</div>
          <aside className="space-y-4">
            <section className="card p-5 text-sm">
              <dl className="space-y-1">
                <div className="flex justify-between">
                  <dt className="text-muted">Total</dt>
                  <dd className="tnum">{m(inv.totalMinor)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Paid</dt>
                  <dd className="tnum">{m(inv.netPaidMinor)}</dd>
                </div>
                <div className="flex justify-between font-semibold text-[15px] pt-1 border-t border-line">
                  <dt>{balance < 0 ? "Overpaid" : "Balance"}</dt>
                  <dd className="tnum">{m(Math.abs(balance))}</dd>
                </div>
              </dl>
              {inv.currentVersion?.sheet.dueDate && inv.status === "issued" && (
                <p className={`mt-2 ${inv.display.key === "overdue" ? "text-danger" : "text-muted"}`}>
                  Due {formatDateLong(inv.currentVersion.sheet.dueDate)}
                  {inv.display.key === "overdue" ? ` · ${daysBetween(inv.currentVersion.sheet.dueDate, today)} days ago` : ""}
                </p>
              )}
            </section>
            <section className="card p-5 text-sm">
              <h3 className="font-semibold mb-2">Payments</h3>
              {inv.payments.filter((p) => !p.deleted).length === 0 && <p className="text-muted">None yet.</p>}
              <ul className="space-y-1">
                {inv.payments
                  .filter((p) => !p.deleted)
                  .map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="text-muted w-20">{formatDateLong(p.receivedOn).replace(/ \d{4}$/, "")}</span>
                      <span className="tnum flex-1">
                        {p.kind === "refund" ? "−" : ""}
                        {m(p.amountMinor)} <span className="text-muted">{p.method.replace("_", " ")}</span>
                      </span>
                      <ActionForm action={removePayment} showError={false}>
                        {hidden}
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button type="submit" className="btn btn-ghost btn-sm" aria-label="Remove payment">
                          ✕
                        </button>
                      </ActionForm>
                    </li>
                  ))}
              </ul>
            </section>
            {inv.versions.length > 1 && (
              <section className="card p-5 text-sm">
                <h3 className="font-semibold mb-2">Previous versions</h3>
                <ul className="space-y-2">
                  {inv.versions.map((v) => (
                    <li key={v.id}>
                      <a href={`/invoices/${inv.id}/pdf?version=${v.id}`} target="_blank" rel="noreferrer" className="text-accent font-medium">
                        Revision {v.rev}
                      </a>{" "}
                      <span className="text-muted">
                        · {when(v.frozenAt)} · {m(v.total)}
                      </span>
                      {v.changeSummary && <div className="text-muted">{v.changeSummary}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {!isDraft && (
        <section className="card p-5 text-sm mt-6 max-w-[800px]">
          <h3 className="font-semibold mb-3">Activity</h3>
          <ul className="space-y-2">
            {inv.activity.map((a) => {
              const email = inv.emails.find((e) => e.id === a.data.emailId);
              return (
                <li key={a.id}>
                  <span className="font-medium">{ACTIVITY[a.kind] ?? a.kind}</span>
                  {a.kind === "note" && <span>: {String(a.data.text)}</span>}
                  {Array.isArray(a.data.to) && <span> to {(a.data.to as string[]).join(", ")}</span>}
                  {typeof a.data.amountMinor === "number" && <span className="tnum"> · {m(a.data.amountMinor)}</span>}
                  {typeof a.data.changeSummary === "string" && <span className="text-muted"> · {a.data.changeSummary}</span>}
                  {a.kind === "viewed" && typeof a.data.rev === "number" && <span className="text-muted"> · rev {a.data.rev}</span>}
                  <span className="text-muted"> · {when(a.at)}</span>
                  {email && (
                    <details className="mt-1 ml-4">
                      <summary className="cursor-pointer text-accent">
                        {email.status === "sent" ? "Sent" : email.status === "failed" ? "Failed" : email.status === "waiting_for_pdf" ? "Waiting for PDF" : "Queued"} · view email
                      </summary>
                      <div className="mt-2 p-3 bg-sunken rounded-md space-y-1">
                        <div>
                          <b>To</b> {email.to.join(", ")}
                          {email.cc.length > 0 && <> · <b>Cc</b> {email.cc.join(", ")}</>}
                        </div>
                        <div>
                          <b>Subject</b> {email.subject}
                        </div>
                        <pre className="whitespace-pre-wrap font-sans">{email.textBody}</pre>
                        {email.attachments.map((at) => (
                          <div key={at.sha256} className="t-caption">
                            📎 {at.name} · {Math.round(at.bytes / 1024)} KB · sha256 {at.sha256.slice(0, 12)}…
                          </div>
                        ))}
                        {email.lastError && email.status !== "sent" && <div className="text-danger">{email.lastError}</div>}
                        {email.status === "failed" && (
                          <ActionForm action={retryEmail}>
                            {hidden}
                            <input type="hidden" name="emailId" value={email.id} />
                            <Submit className="btn btn-secondary btn-sm">Retry</Submit>
                          </ActionForm>
                        )}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          <ActionForm action={addInvoiceNote} reset className="flex gap-2 mt-4">
            {hidden}
            <label className="sr-only" htmlFor="note-text">
              Add note
            </label>
            <input id="note-text" name="text" className="input" placeholder="Add a note" required />
            <Submit className="btn btn-secondary">Add note</Submit>
          </ActionForm>
        </section>
      )}

      {preview && (
        <UrlDialog param="send" title={preview.kind === "correction" ? `Send correction to ${inv.number}` : preview.kind === "reminder" ? `Send reminder for ${inv.number}` : isDraft ? "Send invoice" : `Resend ${inv.number}`}>
          <SendForm invoiceId={inv.id} clientId={inv.client.id} preview={preview} isFirst={isDraft} changeSummary={prefilled} today={today} />
        </UrlDialog>
      )}
      {sp.pay && inv.status === "issued" && (
        <UrlDialog param="pay" title={sp.pay === "refund" ? "Record refund" : "Record payment"} variant="panel">
          <PaymentForm invoiceId={inv.id} currency={inv.currency} balanceMinor={balance} today={today} refund={sp.pay === "refund"} />
        </UrlDialog>
      )}
      {sp.void && inv.canVoid && (
        <UrlDialog param="void" title={`Void ${inv.number}?`}>
          <VoidForm invoiceId={inv.id} number={inv.number ?? ""} entries={inv.claimedEntries} />
        </UrlDialog>
      )}
    </div>
  );
}

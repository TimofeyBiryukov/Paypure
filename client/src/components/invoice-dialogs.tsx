"use client";

import { formatMoney, minorToDecimalString } from "@paypure/domain";
import { useState } from "react";
import { recordPayment, sendInvoice, voidInvoice } from "@/app/actions/invoices";
import { Submit } from "./submit";
import { ActionForm, FieldError } from "./toaster";
import { CloseButton } from "./url-dialog";

export interface EmailPreview {
  kind: "invoice" | "correction" | "reminder";
  to: string[];
  subject: string;
  message: string;
  missing: string[];
  attachment: string;
  noPaymentAccount: boolean;
  currency: string;
  issueDate: string;
  me: string;
}

/**
 * S12: one dialog for send, correction and reminder. A hidden idempotency key, made when the
 * dialog opens, means a double submit sends once (08 §7.2).
 */
export function SendForm({ invoiceId, clientId, preview, isFirst, changeSummary, today }: { invoiceId: string; clientId: string; preview: EmailPreview; isFirst: boolean; changeSummary?: string; today: string }) {
  const [key] = useState(() => crypto.randomUUID());
  const [testKey] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState(preview.to.join(", "));
  const label = preview.kind === "correction" ? "Send correction" : preview.kind === "reminder" ? "Send reminder" : "Send invoice";
  return (
    <ActionForm action={sendInvoice} closeDialog className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="me" value={preview.me} />
      {preview.noPaymentAccount && <p className="banner banner-warning text-sm">No payment account for {preview.currency}. You can still send.</p>}
      <div>
        <label className="label" htmlFor="send-to">
          To
        </label>
        <input id="send-to" name="to" className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="jane@acme.co" autoComplete="off" />
        {preview.to.length === 0 && (
          <label className="flex items-center gap-2 mt-1 text-sm">
            <input type="checkbox" name="saveEmails" defaultChecked /> Also save as the client's billing email
          </label>
        )}
        <FieldError name="to" />
      </div>
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="label" htmlFor="send-cc">
            Cc
          </label>
          <input id="send-cc" name="cc" className="input" autoComplete="off" />
        </div>
        <label className="flex items-center gap-2 h-9 text-sm">
          <input type="checkbox" name="copyMe" /> Send me a copy
        </label>
      </div>
      {isFirst && (
        <div>
          <label className="label" htmlFor="send-issue">
            Issue date
          </label>
          <input id="send-issue" type="date" name="issueDate" className="input w-auto" defaultValue={preview.issueDate} max={today} />
          <p className="hint">The number is assigned when you send.</p>
        </div>
      )}
      {preview.kind === "correction" && (
        <div>
          <label className="label" htmlFor="send-changes">
            What changed (printed in the email and on the public page)
          </label>
          <textarea id="send-changes" name="changeSummary" className="textarea" required defaultValue={changeSummary} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="send-subject">
          Subject
        </label>
        <input id="send-subject" name="subject" className="input" defaultValue={preview.subject} required />
      </div>
      <div>
        <label className="label" htmlFor="send-message">
          Message
        </label>
        <textarea id="send-message" name="message" className="textarea" rows={8} defaultValue={preview.message} required />
        {preview.missing.length > 0 && <p className="error-text">Fill in: {preview.missing.map((m) => `{{${m}}}`).join(", ")}</p>}
      </div>
      <p className="text-sm text-muted">
        Attached: {preview.attachment} · includes a link to view online
      </p>
      <div className="flex gap-2 flex-wrap">
        {/* The primary action is the first submit button (Guide §7.2 rule 2) */}
        <Submit name="kind" value={preview.kind} pendingText="Sending…" className="btn btn-primary btn-lg">
          {label}
        </Submit>
        {preview.kind !== "reminder" && (
          <button type="submit" name="kind" value="test" className="btn btn-secondary btn-lg" formNoValidate onClick={(e) => {
            const f = e.currentTarget.form;
            const k = f?.querySelector<HTMLInputElement>('input[name="idempotencyKey"]');
            if (k) k.value = testKey;
          }}>
            Send test to me
          </button>
        )}
        <CloseButton />
      </div>
    </ActionForm>
  );
}

export function PaymentForm({ invoiceId, currency, balanceMinor, today, refund }: { invoiceId: string; currency: string; balanceMinor: number; today: string; refund?: boolean }) {
  const [amount, setAmount] = useState(minorToDecimalString(Math.max(0, refund ? 0 : balanceMinor), currency));
  const over = !refund && Number(amount) * 100 > balanceMinor && balanceMinor >= 0;
  return (
    <ActionForm action={recordPayment} closeDialog className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="currency" value={currency} />
      <fieldset>
        <legend className="label">Type</legend>
        <div className="seg">
          <label>
            <input type="radio" name="kind" value="payment" defaultChecked={!refund} />
            <span className="px-3 h-8 inline-flex items-center">Payment</span>
          </label>
          <label>
            <input type="radio" name="kind" value="refund" defaultChecked={refund} />
            <span className="px-3 h-8 inline-flex items-center">Refund</span>
          </label>
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="pay-amount">
          Amount ({currency})
        </label>
        <input id="pay-amount" name="amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        {over && <p className="hint text-warning">More than the balance of {formatMoney({ minor: balanceMinor, currency })}. The invoice will show as overpaid.</p>}
        <FieldError name="amount" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="pay-date">
            Date
          </label>
          <input id="pay-date" type="date" name="receivedOn" className="input" defaultValue={today} required />
        </div>
        <div>
          <label className="label" htmlFor="pay-method">
            Method
          </label>
          <select id="pay-method" name="method" className="select">
            <option value="bank_transfer">Bank transfer</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="pay-note">
          Note
        </label>
        <input id="pay-note" name="note" className="input" />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="thankYou" /> Send thank-you email
      </label>
      <div className="flex gap-2">
        <Submit pendingText="Recording…">Record payment</Submit>
        <CloseButton />
      </div>
    </ActionForm>
  );
}

export function VoidForm({ invoiceId, number, entries }: { invoiceId: string; number: string; entries: number }) {
  return (
    <ActionForm action={voidInvoice} closeDialog className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <p>
        Void {number}? {entries > 0 ? `${entries} time entries go back to unbilled · ` : ""}the number stays in your sequence · the client's link will show "Void".
      </p>
      <p className="text-muted text-sm">To fix an invoice, correct it instead. Void is for invoices that shouldn't exist.</p>
      <div>
        <label className="label" htmlFor="void-reason">
          Reason (optional)
        </label>
        <input id="void-reason" name="reason" className="input" placeholder="Sent to the wrong client" />
      </div>
      <div className="flex gap-2">
        <Submit className="btn btn-danger" pendingText="Voiding…">
          Void invoice
        </Submit>
        <CloseButton />
      </div>
    </ActionForm>
  );
}

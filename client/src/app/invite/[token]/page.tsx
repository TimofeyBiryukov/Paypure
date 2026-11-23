import { acceptInvite } from "@/app/actions/auth";
import { Submit } from "@/components/submit";
import { ActionForm, FieldError, ToastProvider } from "@/components/toaster";
import { TzInput } from "@/components/tz-input";

export const metadata = { title: "Join workspace" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <ToastProvider>
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card p-6 w-full max-w-[380px]">
          <h1 className="t-title-2 mb-1">Set your password</h1>
          <p className="text-muted mb-4">You've been invited to Paypure.</p>
          <ActionForm action={acceptInvite} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <TzInput />
            <div>
              <label className="label" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                minLength={8}
                className="input"
                autoComplete="new-password"
                required
                autoFocus
              />
              <p className="hint">At least 8 characters.</p>
              <FieldError name="password" />
            </div>
            <Submit pendingText="Joining…" className="btn btn-primary w-full">
              Join workspace
            </Submit>
          </ActionForm>
        </div>
      </main>
    </ToastProvider>
  );
}

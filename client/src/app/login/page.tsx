import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { Submit } from "@/components/submit";
import { ActionForm, FieldError, ToastProvider } from "@/components/toaster";
import { TzInput } from "@/components/tz-input";
import { getMe } from "@/server/api";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getMe()) redirect("/");
  const { next } = await searchParams;
  return (
    <ToastProvider>
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-[380px]">
          <div className="flex items-center gap-2 font-semibold text-[17px] mb-8 justify-center">
            <span
              className="inline-block w-3.5 h-3.5 rotate-45 rounded-[2px]"
              style={{ background: "var(--accent)" }}
              aria-hidden
            />
            paypure
          </div>
          <div className="card p-6">
            <h1 className="t-title-2 mb-4">Sign in</h1>
            <ActionForm action={login} className="space-y-4" autoComplete="on">
              <input type="hidden" name="next" value={next ?? "/"} />
              <TzInput />
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  autoComplete="email"
                  required
                  autoFocus
                />
                <FieldError name="email" />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Submit className="btn btn-primary w-full" pendingText="Signing in…">
                Sign in
              </Submit>
            </ActionForm>
          </div>
          <p className="t-caption text-center mt-4">Demo: admin@example.com / paypure-demo</p>
        </div>
      </main>
    </ToastProvider>
  );
}

import { redirect } from "next/navigation";
import { deactivateMember, inviteMember } from "@/app/actions/settings";
import { InviteResult } from "@/components/settings-client";
import { Submit } from "@/components/submit";
import { ActionForm, FieldError } from "@/components/toaster";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Members" };

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "invited" | "active" | "deactivated";
}

export default async function MembersPage() {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/settings/profile");
  const members = await api<MemberRow[]>("/v1/settings/members");
  return (
    <div className="space-y-6">
      <section className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{m.name}</td>
                <td className="text-muted">{m.email}</td>
                <td>{m.role === "admin" ? "Admin" : "Member"}</td>
                <td>
                  <span
                    className={`chip ${m.status === "active" ? "chip-success" : m.status === "invited" ? "chip-info" : "chip-neutral"}`}
                  >
                    {m.status === "active"
                      ? "Active"
                      : m.status === "invited"
                        ? "Invited"
                        : "Deactivated"}
                  </span>
                </td>
                <td className="text-right">
                  {m.id !== me.member.id && m.status !== "deactivated" && (
                    <ActionForm action={deactivateMember}>
                      <input type="hidden" name="id" value={m.id} />
                      <Submit className="btn btn-ghost btn-sm text-danger">Deactivate</Submit>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <h2 className="t-title-3 mb-3">Invite member</h2>
        <ActionForm action={inviteMember} reset>
          <div className="grid sm:grid-cols-[1fr_1fr_140px_auto] gap-3 items-end">
            <div>
              <label className="label" htmlFor="inv-name">
                Name
              </label>
              <input id="inv-name" name="name" className="input" required autoComplete="off" />
              <FieldError name="name" />
            </div>
            <div>
              <label className="label" htmlFor="inv-email">
                Email
              </label>
              <input
                id="inv-email"
                name="email"
                type="email"
                className="input"
                required
                autoComplete="off"
              />
              <FieldError name="email" />
            </div>
            <div>
              <label className="label" htmlFor="inv-role">
                Role
              </label>
              <select id="inv-role" name="role" className="select" defaultValue="member">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Submit pendingText="Inviting…">Invite member</Submit>
          </div>
          <p className="hint">
            Members track their own time and see clients and projects, without money.
          </p>
          <InviteResult />
        </ActionForm>
      </section>
    </div>
  );
}

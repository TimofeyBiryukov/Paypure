import { updateProfile } from "@/app/actions/settings";
import { Field, timeZones } from "@/components/settings-fields";
import { Submit } from "@/components/submit";
import { ActionForm, FieldError } from "@/components/toaster";
import { getMe } from "@/server/api";

export const metadata = { title: "Profile" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ProfilePage() {
  const me = (await getMe())!;
  const m = me.member;
  return (
    <section className="card p-6">
      <h2 className="t-title-2 mb-1">Your profile</h2>
      <p className="text-muted mb-5">{m.email}</p>
      <ActionForm action={updateProfile} className="space-y-4" autoComplete="on">
        <Field name="name" label="Name" defaultValue={m.name} required autoComplete="name" />
        <div>
          <label className="label" htmlFor="f-timeZone">
            Time zone
          </label>
          <select id="f-timeZone" name="timeZone" className="select" defaultValue={m.timeZone}>
            {timeZones().map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <p className="hint">
            Used for emails and notifications. Times on screen follow this device ({me.tz}).
          </p>
          <FieldError name="timeZone" />
        </div>
        <fieldset>
          <legend className="label">Time format</legend>
          <div className="seg">
            {(["24h", "12h"] as const).map((f) => (
              <label key={f}>
                <input type="radio" name="timeFormat" value={f} defaultChecked={m.timeFormat === f} />
                {f === "24h" ? "24-hour (14:30)" : "12-hour (2:30 PM)"}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="f-weekStart">
            Week starts on
          </label>
          <select id="f-weekStart" name="weekStart" className="select max-w-[220px]" defaultValue={String(m.weekStart)}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="border-t border-line pt-4 space-y-4">
          <legend className="t-title-3 pt-4">Change password</legend>
          <p className="hint -mt-2">Leave empty to keep your current password.</p>
          <Field name="password" label="New password" type="password" autoComplete="new-password" minLength={8} />
          <Field name="password2" label="Repeat new password" type="password" autoComplete="new-password" minLength={8} />
        </fieldset>
        <Submit pendingText="Saving…">Save profile</Submit>
      </ActionForm>
    </section>
  );
}

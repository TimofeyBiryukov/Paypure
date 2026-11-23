import { CURRENCY_CODES, minorToDecimalString } from "@paypure/domain";
import { FieldError } from "./toaster";

/** Shared client form fields (S6, S7 Details). Server-safe: renders inputs only. */

export function Field({
  name,
  label,
  hint,
  children,
  id,
}: {
  id?: string;
  name: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id ?? `f-${name}`}>
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

/** Only the 10 badge colours, never a free picker (Guide §2.4). */
export function ColourPicker({ value }: { value?: number }) {
  return (
    <fieldset>
      <legend className="label">Colour</legend>
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 10 }, (_, i) => (
          <label key={i} className="cursor-pointer">
            <input type="radio" name="colour" value={i} defaultChecked={value === i} className="peer sr-only" />
            <span
              className="block w-7 h-7 rounded-[4px] peer-checked:ring-2 peer-checked:ring-offset-2 peer-focus-visible:ring-2 ring-[var(--accent)]"
              style={{ background: `var(--c${i})` }}
            />
            <span className="sr-only">Colour {i + 1}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CurrencySelect({ value, disabled }: { value: string; disabled?: boolean }) {
  return (
    <select id="f-currency" name="currency" className="select" defaultValue={value} disabled={disabled}>
      {CURRENCY_CODES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export const moneyValue = (minor: number | null | undefined, currency: string) =>
  minor == null ? "" : minorToDecimalString(minor, currency);

export const hoursValue = (seconds: number | null | undefined) =>
  seconds == null ? "" : String(Math.round((seconds / 3600) * 100) / 100);

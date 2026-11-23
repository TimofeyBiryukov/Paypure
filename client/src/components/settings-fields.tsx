import { FieldError } from "./toaster";

/** Labelled input with its error slot (Guide §7.3: label above, error below). */
export function Field({
  name,
  label,
  hint,
  defaultValue,
  type = "text",
  required,
  autoComplete,
  placeholder,
  textarea,
  inputMode,
  rows,
  minLength,
  idPrefix = "f",
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  textarea?: boolean;
  inputMode?: "decimal" | "numeric" | "email" | "tel" | "text";
  rows?: number;
  minLength?: number;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${name}`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {textarea ? (
        <textarea
          id={id}
          name={name}
          className="textarea"
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          rows={rows ?? 3}
          aria-describedby={`${name}-error`}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          className="input"
          defaultValue={defaultValue ?? ""}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          inputMode={inputMode}
          minLength={minLength}
          aria-describedby={`${name}-error`}
        />
      )}
      {hint && <p className="hint">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/Berlin", "Europe/London", "America/New_York"];
  }
}

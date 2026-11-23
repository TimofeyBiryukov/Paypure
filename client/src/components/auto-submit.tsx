"use client";

/** A <select> that submits its (GET) form on change; the form still works without JS. */
export function AutoSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

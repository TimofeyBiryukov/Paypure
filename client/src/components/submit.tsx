"use client";

import { useFormStatus } from "react-dom";

/** Submit button with a pending state that ignores repeat submits (Guide §7.2 rule 8). */
export function Submit({
  children,
  className = "btn btn-primary",
  pendingText,
  name,
  value,
  disabled,
  title,
  formAction,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  title?: string;
  formAction?: (fd: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      title={title}
      formAction={formAction}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

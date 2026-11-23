"use client";

import { useEffect, useState } from "react";

/** Seeds the member zone from the device on login/invite (06 §3.4). */
export function TzInput() {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  return <input type="hidden" name="tz" value={tz} />;
}

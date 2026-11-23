/** Calendar dates are strings end to end; Prisma maps `date` to a UTC-midnight Date. */
export const s2d = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const d2s = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;
export const truncSec = (d: Date): Date => new Date(Math.floor(d.getTime() / 1000) * 1000);

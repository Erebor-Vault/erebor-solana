import type { ReactNode } from "react";

/**
 * Section grouper for the admin page. Renders a brass "inscribed"
 * eyebrow flanked by small rune-dots, then a hairline rule, then the
 * children. Replaces inline `<h2>` headings so the page reads as zoned
 * (Operations / Allocation / Configuration / Audit) — picks up the
 * deck's ornate-border / inscription language without going skeumorphic.
 */
export function Zone({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-[var(--color-accent-secondary)]/70" />
          <span className="h-px w-4 bg-[var(--color-accent-secondary)]/70" />
          <span className="h-1.5 w-1.5 rotate-45 bg-[var(--color-accent-secondary)]" />
        </span>
        <span className="eyebrow">{eyebrow}</span>
        <span
          aria-hidden
          className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent-secondary)]/40 via-[var(--color-border)] to-transparent"
        />
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

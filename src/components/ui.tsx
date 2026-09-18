import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type CaseStatus, type Origin, type Verification } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Verification & origin — the product's core visual vocabulary
// ---------------------------------------------------------------------------

const VERIFICATION_STYLE: Record<Verification, { label: string; cls: string; glyph: ReactNode }> = {
  verified: {
    label: "Verified",
    cls: "bg-verified-soft text-verified",
    glyph: (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <path d="M2.5 6.3 5 8.7l4.5-5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  partially_verified: {
    label: "Partially verified",
    cls: "bg-partial-soft text-partial",
    glyph: (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1.8a4.2 4.2 0 0 1 0 8.4Z" fill="currentColor" />
      </svg>
    ),
  },
  unverified: {
    label: "Not verified",
    cls: "bg-missing-soft text-ink-2",
    glyph: (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.6" />
      </svg>
    ),
  },
  contradicted: {
    label: "Sources disagree",
    cls: "bg-contradicted-soft text-contradicted",
    glyph: (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  unknown: {
    label: "Unknown",
    cls: "bg-missing-soft text-ink-3",
    glyph: <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />,
  },
};

export function VerificationBadge({ v, className }: { v: Verification; className?: string }) {
  const s = VERIFICATION_STYLE[v];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium", s.cls, className)}>
      {s.glyph}
      {s.label}
    </span>
  );
}

const ORIGIN_STYLE: Record<Origin, { label: string; cls: string }> = {
  official_record: { label: "Official record", cls: "border-ink/15 text-ink-2" },
  user_report: { label: "Reported by citizen", cls: "border-ink/25 border-dotted text-ink-2" },
  ai_inference: { label: "AI suggestion", cls: "border-accent/50 border-dashed text-accent" },
  computed: { label: "Computed", cls: "border-ink/15 text-ink-2" },
};

export function OriginTag({ o, className }: { o: Origin; className?: string }) {
  const s = ORIGIN_STYLE[o];
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[12px]", s.cls, className)}>{s.label}</span>;
}

const STATUS_STYLE: Record<CaseStatus, string> = {
  reported: "bg-paper-3 text-ink-2",
  investigating: "bg-partial-soft text-partial",
  evidence_found: "bg-accent-soft text-accent-ink",
  case_prepared: "bg-accent-soft text-accent-ink",
  submitted: "bg-ink text-paper",
  awaiting_response: "bg-ink text-paper",
  resolved: "bg-verified-soft text-verified",
  closed: "bg-paper-3 text-ink-3",
};

export function StatusPill({ status, className, live }: { status: CaseStatus; className?: string; live?: boolean }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium", STATUS_STYLE[status], className)}>
      {live && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" aria-hidden />}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex h-6 items-center rounded-full border border-dashed border-ink/30 px-2.5 text-[12px] text-ink-2", className)}
      title="Illustrative report created to demonstrate the workflow. Linked official records are real."
    >
      Demo report
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout & controls
// ---------------------------------------------------------------------------

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1240px] px-4 sm:px-6", className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12px] font-medium uppercase tracking-[0.14em] text-ink-3", className)}>{children}</p>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "accent";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-accent-ink",
  accent: "bg-accent text-white hover:bg-accent-ink",
  secondary: "border border-rule-strong bg-card text-ink hover:border-ink/40",
  ghost: "text-ink-2 hover:bg-paper-3 hover:text-ink",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" | "lg" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3.5 text-[13px]" : size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-5 text-[14px]",
    BUTTON[variant],
  );
}

export function Button({ variant = "primary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-rule bg-card shadow-card", className)} {...props} />;
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-4 w-4", className)} aria-hidden>
      <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3.5 w-3.5", className)} aria-hidden>
      <path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Formats an ISO date (YYYY-MM-DD or full) as "18 Sep 2026". */
export function formatDate(iso: string) {
  const d = iso.length === 10 ? new Date(iso + "T00:00:00Z") : new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : "Asia/Kolkata" });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

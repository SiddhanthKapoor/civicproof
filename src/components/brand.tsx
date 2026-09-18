import Link from "next/link";
import { cn } from "@/lib/utils";

/** The mark is a citation bracket around a location dot: every claim carries its [source]. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={cn("h-7 w-7", className)}>
      <path d="M9 5H5.5v18H9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
      <path d="M19 5h3.5v18H19" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
      <circle cx="14" cy="14" r="3.6" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2 text-ink", className)} aria-label="CivicProof home">
      <Mark className="transition-transform duration-300 group-hover:scale-[1.06]" />
      <span className="text-[19px] leading-none tracking-[-0.01em]">
        <span className="font-sans font-semibold">Civic</span>
        <span className="font-serif italic">Proof</span>
      </span>
    </Link>
  );
}

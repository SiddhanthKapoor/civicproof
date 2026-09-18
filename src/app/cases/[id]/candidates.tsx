import Link from "next/link";
import { matchPlacement, type ProjectMatch } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/** Every project the location search returned, with the reasons, and which one was linked. */
export function Candidates({ matches, selectedId }: { matches: ProjectMatch[]; selectedId?: string }) {
  if (!matches.length) return null;
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Projects considered</p>
      <ul className="mt-2 divide-y divide-rule">
        {matches.slice(0, 5).map((m) => (
          <li key={m.projectId} className="grid gap-1 py-2.5 sm:grid-cols-[1fr_auto] sm:gap-4">
            <div className="min-w-0">
              <Link href={m.linkedBy === "name" ? `/sources/${m.projectId}` : `/projects/${m.projectId}`} className={cn("text-[14px] leading-snug hover:text-accent", m.projectId === selectedId ? "font-medium text-ink" : "text-ink-2")}>
                {m.projectName}
              </Link>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{m.reasons.join(" · ")}</p>
            </div>
            <div className="flex items-center gap-2 text-[12px] sm:justify-end">
              <span className="font-mono text-ink-3">{matchPlacement(m)}</span>
              {m.projectId === selectedId && <span className="rounded-full bg-ink px-2 py-0.5 text-paper">Linked</span>}
            </div>
          </li>
        ))}
      </ul>
      {matches.length > 1 && Math.abs(matches[0].score - matches[1].score) < 0.05 && (
        <p className="mt-2 rounded-lg bg-partial-soft px-3 py-2 text-[12.5px] text-partial">
          The top candidates are almost equally close. The case links to one, and lists confirming the responsible contract as an open question.
        </p>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import type { CaseSummary } from "@/lib/store/types";
import { CATEGORY_LABELS, STATUS_LABELS, type CaseStatus } from "@/lib/schemas";
import { Container, DemoTag, formatDate, StatusPill } from "@/components/ui";
import { STATUS_COLOR } from "@/components/map-view";
import { cn } from "@/lib/utils";

const MapView = dynamic(() => import("@/components/map-view").then((m) => m.MapView), { ssr: false, loading: () => <div className="h-full w-full bg-paper-2" /> });

type Filter = "all" | "open" | "evidence" | "submitted" | "resolved";
const FILTERS: Array<{ id: Filter; label: string; test: (s: CaseStatus) => boolean }> = [
  { id: "all", label: "All", test: () => true },
  { id: "open", label: "Open", test: (s) => s === "reported" || s === "investigating" },
  { id: "evidence", label: "Evidence found", test: (s) => s === "evidence_found" || s === "case_prepared" },
  { id: "submitted", label: "Submitted", test: (s) => s === "submitted" || s === "awaiting_response" },
  { id: "resolved", label: "Closed", test: (s) => s === "resolved" || s === "closed" },
];

export function CaseExplorer({
  cases,
  projects,
}: {
  cases: CaseSummary[];
  projects: Array<{ id: string; name: string; geometry: GeoJSON.Geometry; kind: string }>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | undefined>();
  const [focus, setFocus] = useState<{ lat: number; lng: number } | undefined>();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const q = query.trim().toLowerCase();
    return cases.filter((c) => f.test(c.status) && (!q || `${c.title} ${c.locality ?? ""} ${c.projectName ?? ""} ${c.id}`.toLowerCase().includes(q)));
  }, [cases, filter, query]);

  const sel = cases.find((c) => c.id === selected);
  const mapCases = useMemo(() => shown.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, status: c.status })), [shown]);
  const mapProjects = useMemo(() => projects.map((p) => ({ ...p, approx: p.kind !== "official" })), [projects]);

  return (
    <Container className="grid gap-5 pb-10 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative overflow-hidden rounded-2xl border border-rule shadow-card lg:sticky lg:top-20 lg:h-[calc(100vh-110px)]">
        <MapView
          className="h-[420px] lg:h-full"
          cases={mapCases}
          projects={mapProjects}
          selectedCaseId={selected}
          highlightProjectId={sel?.projectId}
          center={focus}
          onSelectCase={(id) => {
            setSelected(id);
            document.getElementById(`case-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          label="Map of reported cases and project alignments"
        />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-rule bg-card/95 px-3 py-2 text-[11.5px] text-ink-2 shadow-card backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(["reported", "investigating", "evidence_found", "submitted", "resolved"] as CaseStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABELS[s]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full bg-[#6f80d6]" /> Project (official)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[3px] w-4 bg-[repeating-linear-gradient(90deg,#6f80d6_0_4px,transparent_4px_7px)]" /> Project (approximate)
            </span>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-col gap-3">
          <input
            className="w-full rounded-xl border border-rule-strong bg-card px-3.5 py-2.5 text-[14.5px] placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10"
            placeholder="Search by road, locality, project or case ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search cases"
          />
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => {
              const n = cases.filter((c) => f.test(c.status)).length;
              return (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "relative h-8 rounded-full px-3 text-[13px] transition-colors",
                    filter === f.id ? "text-paper" : "text-ink-2 hover:bg-paper-3",
                  )}
                >
                  {filter === f.id && <motion.span layoutId="case-filter" className="absolute inset-0 -z-10 rounded-full bg-ink" transition={{ type: "spring", bounce: 0.18, duration: 0.4 }} />}
                  {f.label} <span className={cn("tnum", filter === f.id ? "text-paper/60" : "text-ink-3")}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <ul className="mt-4 space-y-2.5">
          <AnimatePresence initial={false}>
            {shown.map((c) => (
              <motion.li key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <div
                  id={`case-${c.id}`}
                  onMouseEnter={() => setSelected(c.id)}
                  className={cn(
                    "group relative rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] duration-200",
                    selected === c.id ? "border-ink/30 shadow-lift" : "border-rule shadow-card hover:border-ink/20",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill status={c.status} />
                    {c.demo && <DemoTag />}
                    <span className="ml-auto font-mono text-[11.5px] text-ink-3">{c.id}</span>
                  </div>
                  <Link href={`/cases/${c.id}`} className="mt-2 block font-serif text-[19px] leading-snug text-ink after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover:text-accent-ink">
                    {c.title}
                  </Link>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    {CATEGORY_LABELS[c.category]} · observed {formatDate(c.observedOn)}
                    {c.locality ? ` · ${c.locality}` : ""}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-rule pt-3 text-[12.5px]">
                    <span className={cn("min-w-0 truncate", c.projectName ? "text-ink-2" : "text-ink-3")}>
                      {c.projectName ? `Project: ${c.projectName}` : "No project identified"}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {c.verifiedClaims > 0 && <span className="text-verified">{c.verifiedClaims} verified</span>}
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(c.id);
                          setFocus({ lat: c.lat, lng: c.lng });
                        }}
                        className="relative z-[1] rounded-full px-2 py-0.5 text-ink-3 hover:bg-paper-3 hover:text-ink"
                      >
                        Show on map
                      </button>
                    </span>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
          {shown.length === 0 && (
            <li className="rounded-2xl border border-dashed border-rule-strong p-6 text-center text-[14px] text-ink-3">
              No cases match. <Link href="/report" className="text-ink underline underline-offset-4">Report one</Link>.
            </li>
          )}
        </ul>
      </div>
    </Container>
  );
}

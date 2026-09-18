"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { Claim, Evidence, MissingItem, PublicCase } from "@/lib/schemas";
import { CATEGORY_LABELS } from "@/lib/schemas";
import type { StageId } from "@/lib/agent/stages";
import { formatDistance } from "@/lib/geo";
import { Button, buttonClass, Container, DemoTag, ExternalIcon, formatDate, StatusPill } from "@/components/ui";
import { InvestigationPanel, type LiveState } from "./investigation-panel";
import { Findings } from "./findings";
import { ProvenanceChain } from "./chain";
import { Candidates } from "./candidates";
import { RtiClockCard } from "./rti-clock-card";
import { NextActions } from "./actions";
import { saveOwnerKey, useStoredOwnerKey } from "@/lib/use-owner-key";
import { Timeline, TrackingPanel } from "./tracking";

const MapView = dynamic(() => import("@/components/map-view").then((m) => m.MapView), { ssr: false, loading: () => <div className="h-full w-full bg-paper-2" /> });

export interface DossierProject {
  id: string;
  name: string;
  geometry: GeoJSON.Geometry;
  geometryNote: string;
  geometryKind: "official" | "openstreetmap" | "geocoded";
  locality?: string;
  authorityName?: string;
  officer?: string;
  documents: Array<{ id: string; title: string; publisher: string; pages: number; url?: string }>;
}

const LOCATION_SOURCE: Record<PublicCase["location"]["source"], string> = {
  photo_exif: "from the photo's GPS",
  device: "from the reporter's device",
  map_pin: "pin placed by the reporter",
  geocoded: "from an address search",
  official_record: "from an official record",
};

function SectionHeading({ id, n, title, children }: { id: string; n: string; title: string; children?: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="font-mono text-[12px] text-ink-3">{n}</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-serif text-[28px] leading-tight tracking-[-0.01em]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function OwnerKeyNotice({ ownerKey, onDismiss }: { ownerKey: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-2xl border border-ink/20 bg-card p-4 shadow-lift sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14.5px] font-medium">Case created. Keep your owner key.</p>
          <p className="mt-0.5 text-[13px] text-ink-2">It proves you filed this report, so only you can record submissions and responses. It&apos;s saved in this browser; copy it somewhere safe too.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code className="max-w-[220px] truncate rounded-lg bg-paper-2 px-2.5 py-1.5 font-mono text-[12px]">{ownerKey}</code>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(ownerKey).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <button type="button" onClick={onDismiss} className="h-8 w-8 rounded-full text-ink-3 hover:bg-paper-3 hover:text-ink" aria-label="Dismiss">×</button>
        </div>
      </div>
    </motion.div>
  );
}

export function CaseDossier({ initial, projects }: { initial: PublicCase; projects: DossierProject[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [caseData, setCaseData] = useState(initial);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [live, setLive] = useState<LiveState>({ running: false, trace: [] });
  const [liveClaims, setLiveClaims] = useState<{ claims: Claim[]; evidence: Evidence[]; missing: MissingItem[] } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const started = useRef(false);

  // Owner key: arrives in the URL fragment right after reporting (then saved), else from this browser.
  const storedKey = useStoredOwnerKey(initial.id);
  useEffect(() => {
    const m = window.location.hash.match(/k=([^&]+)/);
    if (!m) return;
    saveOwnerKey(initial.id, decodeURIComponent(m[1]));
    history.replaceState(null, "", window.location.pathname + window.location.search.replace(/([?&])new=1&?/, "$1").replace(/[?&]$/, ""));
    queueMicrotask(() => setShowKey(true));
  }, [initial.id]);
  useEffect(() => {
    if (!storedKey) return;
    let cancelled = false;
    fetch(`/api/cases/${initial.id}`, { headers: { "x-owner-key": storedKey } })
      .then((r) => r.json())
      .then((d) => !cancelled && setOwnerKey(d.isOwner ? storedKey : null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initial.id, storedKey]);

  const run = useCallback(async () => {
    setRunError(null);
    setLive({ running: true, trace: [] });
    setLiveClaims({ claims: [], evidence: [], missing: [] });

    // Events are applied in order through a small queue so fast runs stay readable.
    // Nothing is invented or reordered; slow (model-driven) runs are never delayed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queue: any[] = [];
    let drained: Promise<void> = Promise.resolve();
    let draining = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (e: any) => {
      if (e.type === "started") setLive((l) => ({ ...l, engine: e.engine, model: e.model }));
      else if (e.type === "stage") setLive((l) => ({ ...l, stage: e.stage as StageId }));
      else if (e.type === "trace") setLive((l) => ({ ...l, trace: [...l.trace, e.step] }));
      else if (e.type === "claim") setLiveClaims((st) => (st ? { ...st, claims: [...st.claims, e.claim], evidence: [...st.evidence, ...e.evidence] } : st));
      else if (e.type === "missing") setLiveClaims((st) => (st ? { ...st, missing: [...st.missing, e.item] } : st));
      else if (e.type === "complete") {
        setCaseData(e.case);
        setLiveClaims(null);
        setLive((l) => ({ ...l, running: false }));
        router.refresh();
      } else if (e.type === "failed") {
        setRunError(e.error);
        setLive((l) => ({ ...l, running: false, error: e.error }));
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueue = (e: any) => {
      queue.push(e);
      if (draining) return;
      draining = true;
      drained = (async () => {
        while (queue.length) {
          const next = queue.shift();
          apply(next);
          if (next.type === "trace" || next.type === "claim") await new Promise((r) => setTimeout(r, queue.length > 40 ? 25 : 110));
        }
        draining = false;
      })();
    };

    try {
      const res = await fetch(`/api/cases/${caseData.id}/investigate`, { method: "POST" });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        setRunError(d.error ?? "The investigation couldn't start.");
        setLive({ running: false, trace: [] });
        setLiveClaims(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) enqueue(JSON.parse(line));
        }
      }
      await drained;
      while (draining) await drained;
    } catch {
      setRunError("The connection dropped. The investigation keeps running on the server; refresh in a moment to see its result.");
    } finally {
      setLive((l) => ({ ...l, running: false }));
      setLiveClaims((st) => st && null);
    }
  }, [caseData.id, router]);

  // A new report starts its investigation straight away.
  useEffect(() => {
    if (started.current) return;
    if (search.get("new") === "1" && !initial.investigation) {
      started.current = true;
      queueMicrotask(() => void run());
    }
  }, [search, initial.investigation, run]);

  const inv = caseData.investigation;
  const selected = projects.find((p) => p.id === inv?.selectedProjectId);
  const match = inv?.matches.find((m) => m.projectId === inv.selectedProjectId);
  const shown = liveClaims && live.running ? liveClaims : { claims: inv?.claims ?? [], evidence: inv?.evidence ?? [], missing: inv?.missing ?? [] };
  const photo = caseData.photos[0];
  const canRun = !live.running && (caseData.timeline.filter((e) => e.type === "investigation_started").length < 5);

  const mapCases = useMemo(() => [{ id: caseData.id, lat: caseData.location.lat, lng: caseData.location.lng, status: caseData.status }], [caseData.id, caseData.location.lat, caseData.location.lng, caseData.status]);
  const mapProjects = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name, geometry: p.geometry, approx: p.geometryKind !== "official" })), [projects]);

  return (
    <div className="pb-10">
      <div className="border-b border-rule bg-paper">
        <Container className="pb-8 pt-8 sm:pt-10">
          <AnimatePresence>{showKey && ownerKey && <div className="mb-6"><OwnerKeyNotice ownerKey={ownerKey} onDismiss={() => setShowKey(false)} /></div>}</AnimatePresence>
          <nav className="flex items-center gap-2 text-[13px] text-ink-3" aria-label="Breadcrumb">
            <Link href="/cases" className="hover:text-ink">Cases</Link>
            <span aria-hidden>/</span>
            <span className="font-mono text-ink-2">{caseData.id}</span>
          </nav>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill status={caseData.status} live={live.running} />
            <span className="inline-flex h-6 items-center rounded-full border border-rule-strong px-2.5 text-[12px] text-ink-2">{CATEGORY_LABELS[caseData.category]}</span>
            {caseData.demo && <DemoTag />}
          </div>
          <h1 className="mt-3 max-w-4xl font-serif text-[34px] leading-[1.08] tracking-[-0.01em] sm:text-[46px]">{caseData.title}</h1>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[13.5px] text-ink-2">
            <span>Observed {formatDate(caseData.observedOn)}</span>
            <span>Reported {formatDate(caseData.reportedAt)}</span>
            <span>{caseData.location.locality ?? caseData.location.address ?? `${caseData.location.lat.toFixed(5)}, ${caseData.location.lng.toFixed(5)}`}</span>
            {selected && match && <span className="text-ink">Linked to {selected.name.length > 60 ? selected.name.slice(0, 60) + "…" : selected.name} · {match.distanceM < 15 ? "on the alignment" : formatDistance(match.distanceM)}</span>}
          </div>
          {caseData.demo && caseData.demoNote && <p className="mt-3 max-w-3xl text-[13px] text-ink-3">{caseData.demoNote}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={`/cases/${caseData.id}/packet?kind=complaint`} className={buttonClass("primary", "md")}>Complaint packet</Link>
            <Link href={`/cases/${caseData.id}/packet?kind=rti`} className={buttonClass("secondary", "md")}>RTI draft</Link>
            {selected && <Link href={`/projects/${selected.id}`} className={buttonClass("ghost", "md")}>Project record</Link>}
          </div>
        </Container>
      </div>

      <Container className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div className="min-w-0 space-y-14">
          <section className="space-y-5">
            <SectionHeading id="investigation" n="01" title="Investigation" />
            {runError && <p className="rounded-xl bg-contradicted-soft px-4 py-3 text-[14px] text-contradicted" role="alert">{runError}</p>}
            <InvestigationPanel caseData={caseData} live={live} onRun={run} canRun={canRun} />
          </section>

          <section className="space-y-5">
            <SectionHeading id="chain" n="02" title="From report to responsibility" />
            <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
              <ProvenanceChain caseData={caseData} project={selected} />
              <Candidates matches={inv?.matches ?? []} selectedId={inv?.selectedProjectId} />
            </div>
          </section>

          {(shown.claims.length > 0 || shown.missing.length > 0) && (
            <section className="space-y-5">
              <SectionHeading id="evidence" n="03" title="Evidence">
                <p className="max-w-sm text-[13px] text-ink-3">Every fact below shows the words it rests on. Open a source to see the page.</p>
              </SectionHeading>
              <Findings claims={shown.claims} evidence={shown.evidence} missing={shown.missing} conflicts={inv?.conflicts ?? []} live={live.running} />
            </section>
          )}

          <section className="space-y-5">
            <SectionHeading id="actions" n="04" title="What to do next" />
            <NextActions caseData={caseData} />
          </section>

          <section className="space-y-5">
            <SectionHeading id="tracking" n="05" title="Tracking" />
            <RtiClockCard caseId={caseData.id} timeline={caseData.timeline} />
            <TrackingPanel
              caseData={caseData}
              ownerKey={ownerKey}
              onUpdated={(c) => {
                setCaseData(c);
                router.refresh();
              }}
              onOwnerKey={async (key) => {
                const r = await fetch(`/api/cases/${caseData.id}`, { headers: { "x-owner-key": key } });
                const d = await r.json().catch(() => ({}));
                if (!d.isOwner) return false;
                saveOwnerKey(caseData.id, key);
                setOwnerKey(key);
                return true;
              }}
            />
            <div className="pt-2">
              <Timeline events={caseData.timeline} />
            </div>
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
            {photo ? (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${photo.key}`} alt={`Photo submitted with ${caseData.id}`} className="aspect-[4/3] w-full object-cover" />
                <figcaption className="space-y-1 border-t border-rule px-4 py-3 text-[12px] text-ink-3">
                  <p>
                    <span className="text-ink-2">SHA-256</span> <span className="font-mono">{photo.sha256.slice(0, 24)}…</span>
                  </p>
                  {photo.exif?.takenAt && <p>Taken {new Date(photo.exif.takenAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} (EXIF)</p>}
                  {photo.credit && <p>{photo.credit}</p>}
                  {caseData.photos.length > 1 && <p>+{caseData.photos.length - 1} more photo{caseData.photos.length > 2 ? "s" : ""}</p>}
                </figcaption>
              </figure>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center bg-paper-2 p-6 text-center">
                <p className="text-[13px] text-ink-3">{caseData.demo ? "Demo report: no photo attached. Real reports include the reporter's photos, fingerprinted with SHA-256." : "No photo attached."}</p>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
            <MapView
              className="h-[260px]"
              cases={mapCases}
              projects={mapProjects}
              selectedCaseId={caseData.id}
              highlightProjectId={inv?.selectedProjectId}
              center={{ lat: caseData.location.lat, lng: caseData.location.lng }}
              zoom={15}
              fitToData={false}
              label="Report location and nearby projects"
            />
            <div className="space-y-1.5 border-t border-rule px-4 py-3 text-[12.5px]">
              <p className="font-mono text-ink-2">{caseData.location.lat.toFixed(6)}, {caseData.location.lng.toFixed(6)}</p>
              <p className="text-ink-3">Location {LOCATION_SOURCE[caseData.location.source]}.</p>
              {selected && <p className="text-ink-3">{selected.geometryNote}</p>}
              <a
                className="inline-flex items-center gap-1 text-ink-2 hover:text-accent"
                href={`https://www.openstreetmap.org/?mlat=${caseData.location.lat}&mlon=${caseData.location.lng}#map=18/${caseData.location.lat}/${caseData.location.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in OpenStreetMap <ExternalIcon />
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">The report</p>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{caseData.description}</p>
            {caseData.reporterName && <p className="mt-2 text-[12.5px] text-ink-3">Reported by {caseData.reporterName}</p>}
          </div>

          {selected && (
            <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
              <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Records on file</p>
              <ul className="mt-2 space-y-2">
                {selected.documents.map((d) => (
                  <li key={d.id}>
                    <Link href={`/sources/${d.id}`} className="group block">
                      <span className="text-[13.5px] leading-snug text-ink group-hover:text-accent">{d.title}</span>
                      <span className="block text-[12px] text-ink-3">{d.publisher} · {d.pages} p.</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </Container>
    </div>
  );
}

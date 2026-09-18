import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCorpus } from "@/lib/corpus";
import { getStore } from "@/lib/store";
import { verifyClaim } from "@/lib/agent/verifier";
import { geometryLengthM, formatDistance } from "@/lib/geo";
import type { Claim, Evidence } from "@/lib/schemas";
import { Container, Eyebrow, ExternalIcon, StatusPill } from "@/components/ui";
import { Findings } from "@/app/cases/[id]/findings";
import { ProjectMap } from "./project-map";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const p = getCorpus().getProject(id);
  return { title: p ? p.name : "Project not found" };
}

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const corpus = getCorpus();
  const project = corpus.getProject(id);
  if (!project) notFound();
  const authority = corpus.getAuthority(project.agencyId);

  // Re-run the verifier on every curated fact, so the badges shown are computed, not asserted.
  const claims: Claim[] = [];
  const evidence: Evidence[] = [];
  for (const ref of project.reference) {
    const r = verifyClaim({ ...ref, origin: "official_record" }, corpus, "ingest");
    claims.push(r.claim);
    evidence.push(...r.evidence);
  }
  const cases = (await getStore().list(500)).filter((c) => c.projectId === id);
  const length = project.geometry ? geometryLengthM(project.geometry) : undefined;

  return (
    <div className="pb-12">
      <div className="border-b border-rule">
        <Container className="pb-8 pt-8 sm:pt-10">
          <nav className="flex items-center gap-2 text-[13px] text-ink-3" aria-label="Breadcrumb">
            <Link href="/sources" className="hover:text-ink">Records</Link>
            <span aria-hidden>/</span>
            <span className="text-ink-2">Project</span>
          </nav>
          <Eyebrow className="mt-5">Project record</Eyebrow>
          <h1 className="mt-2 max-w-4xl font-serif text-[32px] leading-[1.1] tracking-[-0.01em] sm:text-[42px]">{project.name}</h1>
          {project.summary && <p className="mt-3 max-w-3xl text-[16px] text-ink-2">{project.summary}</p>}
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[13.5px]">
            <div><dt className="text-ink-3">Location</dt><dd className="text-ink">{project.locality ?? project.city}</dd></div>
            <div>
              <dt className="text-ink-3">Alignment drawn</dt>
              <dd className="text-ink">
                {length === undefined ? "none published: found by name" : `${formatDistance(length)} · ${project.geometrySource.kind === "official" ? "official GIS" : "approximate (OpenStreetMap)"}`}
              </dd>
            </div>
            <div><dt className="text-ink-3">Documents</dt><dd className="text-ink">{project.documents.length}</dd></div>
            <div><dt className="text-ink-3">Verified facts</dt><dd className="text-verified">{claims.filter((c) => c.verification === "verified").length} of {claims.length}</dd></div>
          </dl>
        </Container>
      </div>

      <Container className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Findings claims={claims} evidence={evidence} missing={[]} conflicts={[]} />
        </div>
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
            {project.geometry ? (
              <ProjectMap project={{ id: project.id, name: project.name, geometry: project.geometry, approx: project.geometrySource.kind !== "official" }} cases={cases.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, status: c.status }))} />
            ) : (
              <p className="px-4 pt-4 text-[13px] font-medium text-ink">No map geometry</p>
            )}
            <p className={project.geometry ? "border-t border-rule px-4 py-3 text-[12.5px] text-ink-3" : "px-4 pb-4 pt-1 text-[12.5px] text-ink-3"}>{project.geometrySource.note}</p>
          </div>

          {authority && (
            <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
              <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Responsible authority</p>
              <p className="mt-2 text-[14.5px] font-medium">{authority.name}</p>
              {(project.officer ?? authority.officer) && <p className="mt-1 text-[13px] text-ink-2">{project.officer ?? authority.officer}</p>}
              {authority.grievance && (
                <p className="mt-3 text-[13px] text-ink-2">
                  Complaints:{" "}
                  {authority.grievance.url ? (
                    <a href={authority.grievance.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-rule-strong underline-offset-4 hover:text-accent">{authority.grievance.name} <ExternalIcon /></a>
                  ) : authority.grievance.name}
                </p>
              )}
              {authority.grievance?.note && <p className="mt-1 text-[12px] text-ink-3">{authority.grievance.note}</p>}
              {authority.rti && (
                <p className="mt-3 text-[13px] text-ink-2">
                  RTI: {authority.rti.addressee}
                  {authority.rti.portalUrl && (
                    <> · <a href={authority.rti.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-rule-strong underline-offset-4 hover:text-accent">portal <ExternalIcon /></a></>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Documents</p>
            <ul className="mt-2 space-y-2">
              {project.documents.map((d) => {
                const doc = corpus.getDocument(d);
                return (
                  <li key={d}>
                    <Link href={`/sources/${d}`} className="text-[13.5px] leading-snug text-ink hover:text-accent">{doc?.title ?? d}</Link>
                    <span className="block text-[12px] text-ink-3">{corpus.pageCount(d)} pages</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Cases on this project</p>
            {cases.length ? (
              <ul className="mt-2 space-y-2.5">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link href={`/cases/${c.id}`} className="text-[13.5px] leading-snug text-ink hover:text-accent">{c.title}</Link>
                    <div className="mt-1"><StatusPill status={c.status} /></div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-ink-3">None yet.</p>
            )}
          </div>
        </aside>
      </Container>
    </div>
  );
}

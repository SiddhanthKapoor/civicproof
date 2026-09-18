import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { casesCorpus } from "@/lib/cases";
import { toPublicCase } from "@/lib/schemas";
import { haversine } from "@/lib/geo";
import { CaseDossier, type DossierProject } from "./case-dossier";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/cases/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const c = await getStore().get(id);
  return { title: c ? `${c.title} (${c.id})` : "Case not found" };
}

export default async function CasePage(props: PageProps<"/cases/[id]">) {
  const { id } = await props.params;
  const c = await getStore().get(id);
  if (!c) notFound();
  // Includes any public records the investigator fetched live for this case.
  const corpus = await casesCorpus(c);

  // Projects to draw: the investigation's candidates, or anything within 1.5 km before it runs.
  const ids = c.investigation?.matches.length
    ? c.investigation.matches.map((m) => m.projectId)
    : corpus.projectsNear(c.location, 1500).map((x) => x.project.id);
  const projects: DossierProject[] = ids
    .map((pid) => corpus.getProject(pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => {
      const authority = corpus.getAuthority(p.agencyId);
      return {
        id: p.id,
        name: p.name,
        geometry: p.geometry,
        geometryNote: p.geometrySource.note,
        geometryKind: p.geometrySource.kind,
        locality: p.locality,
        authorityName: authority?.name,
        officer: p.officer ?? authority?.officer,
        documents: p.documents.map((d) => {
          const doc = corpus.getDocument(d);
          return { id: d, title: doc?.title ?? d, publisher: doc?.publisher ?? "", pages: corpus.pageCount(d), url: doc?.url };
        }),
      };
    });

  const nearby = (await getStore().list(500))
    .filter((x) => x.id !== c.id)
    .map((x) => ({ ...x, distanceM: Math.round(haversine(c.location, { lat: x.lat, lng: x.lng })) }))
    .filter((x) => x.distanceM <= 1500)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 4);

  return <CaseDossier initial={toPublicCase(c)} projects={projects} nearby={nearby} />;
}

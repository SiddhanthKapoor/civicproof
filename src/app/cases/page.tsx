import type { Metadata } from "next";
import { getStore } from "@/lib/store";
import { getCorpus } from "@/lib/corpus";
import { Container } from "@/components/ui";
import { CaseExplorer } from "./case-explorer";

export const metadata: Metadata = { title: "Cases", description: "Reported infrastructure issues and the records behind them." };
export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const cases = await getStore().list(500);
  const corpus = getCorpus();
  const projects = corpus.projects.map((p) => ({ id: p.id, name: p.name, geometry: p.geometry!, kind: p.geometrySource.kind }));
  return (
    <div>
      <Container className="pb-6 pt-10 sm:pt-12">
        <p className="font-mono text-[12px] text-ink-3">{cases.length} case{cases.length === 1 ? "" : "s"} · {projects.length} projects on the map</p>
        <h1 className="mt-2 font-serif text-[40px] leading-[1.05] tracking-[-0.01em] sm:text-[52px]">Cases</h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-2">
          Each dot is a report. Blue lines are public works projects whose records are in the corpus: solid lines follow official
          PMGSY geometry, the rest are traced from OpenStreetMap by road name.
        </p>
      </Container>
      <CaseExplorer cases={cases} projects={projects} />
    </div>
  );
}

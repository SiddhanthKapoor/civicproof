import { describeRuntime } from "@/lib/config";
import { getCorpus } from "@/lib/corpus";
import { handle, json } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle("health", async () => {
  const corpus = getCorpus();
  return json(
    {
      ok: true,
      runtime: describeRuntime(),
      corpus: {
        documents: corpus.documents.length,
        pages: corpus.documents.reduce((s, d) => s + (d.pageCount ?? 0), 0),
        projects: corpus.projects.length,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
});

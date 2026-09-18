import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
const out = "/private/tmp/claude-501/-Users-sid-Desktop-CivicProof/eb5955eb-4462-488f-b30c-b9714a324798/scratchpad/text";
mkdirSync(out, { recursive: true });
for (const f of process.argv.slice(2)) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(f)));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const name = f.split("/").pop()!.replace(".pdf", "");
  writeFileSync(`${out}/${name}.txt`, (text as string[]).map((t, i) => `=== PAGE ${i + 1} ===\n${t}`).join("\n\n"));
  console.log(name, totalPages, (text as string[]).map((t) => t.length).join(","));
}

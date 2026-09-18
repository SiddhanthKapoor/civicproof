/** PDF → text per page (pdf.js via unpdf). Shared by corpus ingest and reporter uploads. */
import { extractText, getDocumentProxy } from "unpdf";

export function cleanPage(s: string) {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  // pdf.js takes ownership of (detaches) the buffer it is given; work on a copy.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map(cleanPage);
}

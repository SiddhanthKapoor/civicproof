import "server-only";
import React from "react";
import { Document, Font, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Packet } from "@/lib/schemas";

/** The PDF base-14 fonts only cover WinAnsi; keep text inside it rather than render tofu. */
function pdfSafe(s: string): string {
  return s
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[•]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ‘’“”…]/g, "");
}

// Letters read better ragged-right without hyphenation, and a hyphen inside a URL changes it.
Font.registerHyphenationCallback((word) => [word]);

const MARGIN = 60;
const URL_SIZE = 7.5;
// Courier is monospaced (0.6 em per character), so a URL can be cut into lines that fit exactly,
// at "/", "?" or "&" where possible, instead of being hyphenated or running off the page.
const URL_CHARS = Math.floor((595.28 - 2 * MARGIN) / (URL_SIZE * 0.6)) - 2;
const URL_RE = /https?:\/\/[^\s"]+[^\s".,;:)]/g;

function urlLines(url: string): string[] {
  const lines: string[] = [];
  let rest = url;
  while (rest.length > URL_CHARS) {
    const head = rest.slice(0, URL_CHARS);
    const cut = Math.max(head.lastIndexOf("/"), head.lastIndexOf("?"), head.lastIndexOf("&"));
    const at = cut > URL_CHARS / 2 ? cut + 1 : URL_CHARS;
    lines.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  return [...lines, rest];
}

/** A paragraph whose URLs sit on their own lines, in Courier, as working links. */
function Paragraph({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const before = text.slice(last, m.index).replace(/[ \t]+$/, "");
    if (before) parts.push(before + "\n");
    parts.push(
      <Link key={m.index} src={m[0]} style={s.url}>
        {urlLines(m[0]).join("\n")}
      </Link>,
    );
    last = m.index + m[0].length;
    if (last < text.length) parts.push("\n");
  }
  const tail = text.slice(last).replace(/^[ \t]+/, "");
  if (tail) parts.push(tail);
  return <Text style={s.body}>{parts}</Text>;
}

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 64, paddingHorizontal: MARGIN, fontFamily: "Times-Roman", fontSize: 10.5, lineHeight: 1.45, color: "#16181d" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 1.4, color: "#737987", marginBottom: 18 },
  meta: { fontFamily: "Helvetica", fontSize: 9, color: "#444954", marginBottom: 2 },
  subject: { fontFamily: "Times-Bold", fontSize: 14, lineHeight: 1.3, marginTop: 10, marginBottom: 16 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 8.5, letterSpacing: 1, color: "#2542c8", marginTop: 14, marginBottom: 5 },
  body: { marginBottom: 2 },
  url: { fontFamily: "Courier", fontSize: URL_SIZE, color: "#2542c8", textDecoration: "none" },
  rule: { borderBottomWidth: 0.6, borderBottomColor: "#dedad0", marginTop: 18, marginBottom: 10 },
  disclaimer: { fontFamily: "Helvetica-Oblique", fontSize: 8, color: "#737987", lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 30, left: 60, right: 60, fontFamily: "Helvetica", fontSize: 7.5, color: "#9aa0ab", flexDirection: "row", justifyContent: "space-between" },
});

function PacketDoc({ packet, caseId }: { packet: Packet; caseId: string }) {
  // Not stamped "draft": this is the file the reporter sends. The disclaimer says how it was prepared.
  const title = packet.kind === "rti" ? "RTI APPLICATION" : packet.kind === "appeal" ? "RTI FIRST APPEAL" : "COMPLAINT";
  return (
    <Document title={pdfSafe(packet.subject)} author="Prepared with CivicProof" subject={`CivicProof ${caseId}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>CIVICPROOF · {title} · {caseId}</Text>
        <Text style={s.meta}>To: {pdfSafe(packet.addressedTo)}</Text>
        <Text style={s.meta}>Prepared: {new Date(packet.editedAt ?? packet.generatedAt).toISOString().slice(0, 10)}</Text>
        <Text style={s.subject}>{pdfSafe(packet.subject)}</Text>
        {packet.sections.map((sec) => (
          <View key={sec.id} wrap>
            <Text style={s.heading}>{pdfSafe(sec.heading.toUpperCase())}</Text>
            {pdfSafe(sec.body)
              .split(/\n{2,}/)
              .map((para, i) => (
                <Paragraph key={i} text={para} />
              ))}
          </View>
        ))}
        <View style={s.rule} />
        <Text style={s.disclaimer}>{pdfSafe(packet.disclaimer)}</Text>
        <View style={s.footer} fixed>
          <Text>CivicProof {caseId}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPacketPdf(packet: Packet, caseId: string): Promise<Buffer> {
  return renderToBuffer(<PacketDoc packet={packet} caseId={caseId} />);
}

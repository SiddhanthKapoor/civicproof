import "server-only";
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Packet } from "@/lib/schemas";

/** The PDF base-14 fonts only cover WinAnsi; keep text inside it rather than render tofu. */
function pdfSafe(s: string): string {
  return s
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[•]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ‘’“”…]/g, "");
}

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 64, paddingHorizontal: 60, fontFamily: "Times-Roman", fontSize: 10.5, lineHeight: 1.45, color: "#16181d" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 1.4, color: "#737987", marginBottom: 18 },
  meta: { fontFamily: "Helvetica", fontSize: 9, color: "#444954", marginBottom: 2 },
  subject: { fontFamily: "Times-Bold", fontSize: 14, lineHeight: 1.3, marginTop: 10, marginBottom: 16 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 8.5, letterSpacing: 1, color: "#2542c8", marginTop: 14, marginBottom: 5 },
  body: { marginBottom: 2 },
  rule: { borderBottomWidth: 0.6, borderBottomColor: "#dedad0", marginTop: 18, marginBottom: 10 },
  disclaimer: { fontFamily: "Helvetica-Oblique", fontSize: 8, color: "#737987", lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 30, left: 60, right: 60, fontFamily: "Helvetica", fontSize: 7.5, color: "#9aa0ab", flexDirection: "row", justifyContent: "space-between" },
});

function PacketDoc({ packet, caseId }: { packet: Packet; caseId: string }) {
  const title = packet.kind === "rti" ? "RTI APPLICATION — DRAFT" : packet.kind === "appeal" ? "RTI FIRST APPEAL — DRAFT" : "COMPLAINT — DRAFT";
  return (
    <Document title={pdfSafe(packet.subject)} author="CivicProof draft" subject={`CivicProof ${caseId}`}>
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
                <Text key={i} style={s.body}>
                  {para}
                </Text>
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

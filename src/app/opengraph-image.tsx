import { ImageResponse } from "next/og";

export const alt = "CivicProof: turn a broken road into a documented case";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f6f4ef", padding: "64px 72px", color: "#16181d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 700 }}>
            <span style={{ marginRight: 6 }}>[</span>
            <span style={{ width: 16, height: 16, borderRadius: 8, background: "#2542c8", marginRight: 6 }} />
            <span>]</span>
          </div>
          <span style={{ fontSize: 34, fontWeight: 600 }}>CivicProof</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, lineHeight: 1.04, letterSpacing: -2, maxWidth: 940 }}>Turn a broken road into a documented case.</div>
          <div style={{ marginTop: 28, fontSize: 28, color: "#444954", maxWidth: 980 }}>
            Every fact quoted from an official record and checked against the page. Complaint and RTI drafts for what&apos;s missing.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 22, color: "#646a77" }}>
          <span style={{ background: "#e3f1e9", color: "#17744a", padding: "6px 16px", borderRadius: 999 }}>Verified</span>
          <span style={{ background: "#f8eedc", color: "#8f5507", padding: "6px 16px", borderRadius: 999 }}>Partially verified</span>
          <span style={{ background: "#efece4", color: "#444954", padding: "6px 16px", borderRadius: 999 }}>Not verified</span>
          <span style={{ marginLeft: "auto" }}>Strands Agents · Cedar · AWS</span>
        </div>
      </div>
    ),
    size,
  );
}

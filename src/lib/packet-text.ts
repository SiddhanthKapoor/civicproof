import type { Packet } from "@/lib/schemas";

/** Plain-text rendering of a packet, for copying into an email or a portal form. */
export function packetToText(p: Packet): string {
  return [
    `To: ${p.addressedTo}`,
    `Subject: ${p.subject}`,
    "",
    ...p.sections.flatMap((s) => [s.heading.toUpperCase(), s.body, ""]),
    "—",
    p.disclaimer,
  ].join("\n");
}

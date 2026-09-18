import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { draftPacket } from "@/lib/cases";
import { rtiClock } from "@/lib/rti-clock";
import { PacketEditor } from "./packet-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/cases/[id]/packet">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Packet · ${id}` };
}

export default async function PacketPage(props: PageProps<"/cases/[id]/packet">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const kind = sp.kind === "rti" ? "rti" : sp.kind === "appeal" ? "appeal" : "complaint";
  const c = await getStore().get(id);
  if (!c) notFound();
  // Saved packets are shown as saved; otherwise a fresh draft is built (not stored until someone acts on it).
  const clock = rtiClock(c.timeline, new Date().toISOString().slice(0, 10));
  const packets = {
    complaint: c.packets.complaint ?? draftPacket(c, "complaint"),
    rti: c.packets.rti ?? draftPacket(c, "rti"),
    ...(clock ? { appeal: c.packets.appeal ?? draftPacket(c, "appeal") } : {}),
  };
  return (
    <PacketEditor
      caseId={c.id}
      caseTitle={c.title}
      demo={c.demo}
      investigated={c.investigation?.status === "complete"}
      initialKind={kind === "appeal" && !clock ? "rti" : kind}
      packets={packets}
      saved={{ complaint: Boolean(c.packets.complaint), rti: Boolean(c.packets.rti), appeal: Boolean(c.packets.appeal) }}
    />
  );
}

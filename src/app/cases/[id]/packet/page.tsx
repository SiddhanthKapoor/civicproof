import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { draftPacket } from "@/lib/cases";
import { PacketEditor } from "./packet-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/cases/[id]/packet">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Packet · ${id}` };
}

export default async function PacketPage(props: PageProps<"/cases/[id]/packet">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const kind = sp.kind === "rti" ? "rti" : "complaint";
  const c = await getStore().get(id);
  if (!c) notFound();
  // Saved packets are shown as saved; otherwise a fresh draft is built (not stored until someone acts on it).
  const packets = {
    complaint: c.packets.complaint ?? draftPacket(c, "complaint"),
    rti: c.packets.rti ?? draftPacket(c, "rti"),
  };
  return (
    <PacketEditor
      caseId={c.id}
      caseTitle={c.title}
      demo={c.demo}
      investigated={c.investigation?.status === "complete"}
      initialKind={kind}
      packets={packets}
      saved={{ complaint: Boolean(c.packets.complaint), rti: Boolean(c.packets.rti) }}
    />
  );
}

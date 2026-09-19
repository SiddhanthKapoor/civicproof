import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { appealUnavailable, casesCorpus, draftPacket } from "@/lib/cases";
import { submissionDestination } from "@/lib/submission";
import type { PacketKind } from "@/lib/schemas";
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
  // Public drafts, built fresh from the case. The reporter's saved packets are private and are
  // loaded in the browser with the owner key.
  const appealNote = appealUnavailable(c);
  const corpus = await casesCorpus(c);
  const packets = {
    complaint: draftPacket(c, "complaint", { corpus }),
    rti: draftPacket(c, "rti", { corpus }),
    ...(appealNote ? {} : { appeal: draftPacket(c, "appeal", { corpus }) }),
  };
  // Where each draft is taken. Resolved on the server from the authority directory; a channel the
  // directory cannot vouch for is reported as unverified rather than guessed at.
  const project = c.investigation?.selectedProjectId ? corpus.getProject(c.investigation.selectedProjectId) : undefined;
  const authority = corpus.getAuthority(project?.agencyId);
  const destinations = Object.fromEntries(
    (["complaint", "rti", "appeal"] as PacketKind[]).map((k) => [k, submissionDestination(k, authority)]),
  ) as Record<PacketKind, ReturnType<typeof submissionDestination>>;

  return (
    <PacketEditor
      destinations={destinations}
      caseId={c.id}
      caseTitle={c.title}
      demo={c.demo}
      investigated={c.investigation?.status === "complete"}
      initialKind={kind === "appeal" && appealNote ? "rti" : kind}
      notice={kind === "appeal" && appealNote ? appealNote : undefined}
      packets={packets}
      saved={{ complaint: Boolean(c.packets.complaint), rti: Boolean(c.packets.rti), appeal: Boolean(c.packets.appeal) }}
    />
  );
}

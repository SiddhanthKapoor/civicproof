"use client";

import { motion } from "motion/react";
import type { PublicCase } from "@/lib/schemas";
import { matchPlacement, STATUS_LABELS } from "@/lib/schemas";

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import { cn } from "@/lib/utils";
import type { DossierProject } from "./case-dossier";

interface Node {
  label: string;
  title: string;
  detail: string;
  established: boolean;
}

/** Report → Project → Official records → Responsible authority → Case, with each link's state. */
export function ProvenanceChain({ caseData, project }: { caseData: PublicCase; project?: DossierProject }) {
  const inv = caseData.investigation;
  const match = inv?.matches.find((m) => m.projectId === inv.selectedProjectId);
  const verifiedDocs = new Set(inv?.evidence.filter((e) => e.verification === "verified").map((e) => e.docId) ?? []);
  const agency = inv?.claims.find((c) => c.field === "agency" && c.verification === "verified");
  const contractor = inv?.claims.find((c) => c.field === "contractor" && c.verification === "verified");

  const nodes: Node[] = [
    {
      label: "Report",
      title: caseData.id,
      detail: `${caseData.location.lat.toFixed(4)}, ${caseData.location.lng.toFixed(4)}`,
      established: true,
    },
    {
      label: "Project",
      title: project ? project.name : "Not identified",
      detail: match
        ? match.linkedBy === "name"
          ? "Linked by the road name in a record fetched from the portal; the record has no map location"
          : `${upperFirst(matchPlacement(match))} · ${project?.geometryKind === "official" ? "official geometry" : "approximate geometry"}`
        : inv ? "No project at this location in the corpus" : "Run the investigation",
      established: Boolean(project && match),
    },
    {
      label: "Official records",
      title: verifiedDocs.size ? `${verifiedDocs.size} document${verifiedDocs.size === 1 ? "" : "s"} cited` : "None cited yet",
      detail: contractor ? `Contractor named: ${contractor.value}` : "Contractor not verified",
      established: verifiedDocs.size > 0,
    },
    {
      label: "Responsible authority",
      title: agency?.value ?? project?.authorityName ?? "Not established",
      detail: agency ? "Verified in the records" : project?.authorityName ? "From the authority directory" : "Ask via RTI",
      established: Boolean(agency),
    },
    {
      label: "Case",
      title: STATUS_LABELS[caseData.status],
      detail: inv?.nextActions[0]?.title ?? "Awaiting investigation",
      established: caseData.status !== "reported",
    },
  ];

  return (
    <ol className="relative grid gap-3 md:grid-cols-5 md:gap-0">
      {nodes.map((n, i) => (
        <li key={n.label} className="relative md:pr-4">
          {i < nodes.length - 1 && (
            <motion.span
              aria-hidden
              className={cn(
                "absolute left-[11px] top-7 h-[calc(100%-4px)] w-px md:left-7 md:top-[11px] md:h-px md:w-[calc(100%-28px)]",
                nodes[i + 1].established ? "bg-ink" : "border-l border-dashed border-rule-strong bg-transparent md:border-l-0 md:border-t",
              )}
              initial={{ scaleX: 0, scaleY: 0 }}
              whileInView={{ scaleX: 1, scaleY: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.15 * i, ease: [0.2, 0.7, 0.2, 1] }}
              style={{ transformOrigin: "left top" }}
            />
          )}
          <div className="flex gap-3 md:block">
            <span
              className={cn(
                "relative z-[1] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-2 bg-paper",
                n.established ? "border-ink" : "border-dashed border-rule-strong",
              )}
            >
              {n.established && <span className="h-2 w-2 rounded-full bg-ink" />}
            </span>
            <div className="pb-4 md:mt-3 md:pb-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{n.label}</p>
              <p className={cn("mt-1 line-clamp-2 text-[14px] font-medium leading-snug", n.established ? "text-ink" : "text-ink-3")}>{n.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-3">{n.detail}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

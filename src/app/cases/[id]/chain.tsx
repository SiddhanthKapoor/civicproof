"use client";

import { motion } from "motion/react";
import type { PublicCase } from "@/lib/schemas";
import { matchPlacement, STATUS_LABELS } from "@/lib/schemas";

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import { cn } from "@/lib/utils";
import type { DossierProject } from "./case-dossier";
import { OVERALL } from "./determination-card";

interface Node {
  label: string;
  title: string;
  detail: string;
  established: boolean;
}

/**
 * Report → Photograph → Project → Official records → Responsible authority → Determination → Case,
 * with each link's state. Two of these are evidence the case rests on rather than steps in a
 * workflow: what the photograph establishes, and what the four determinations add up to. A link is
 * drawn solid only where the next node is established, so an unsupported edge is visibly dashed.
 */
export function ProvenanceChain({ caseData, project }: { caseData: PublicCase; project?: DossierProject }) {
  const inv = caseData.investigation;
  const match = inv?.matches.find((m) => m.projectId === inv.selectedProjectId);
  const verifiedDocs = new Set(inv?.evidence.filter((e) => e.verification === "verified").map((e) => e.docId) ?? []);
  const agency = inv?.claims.find((c) => c.field === "agency" && c.verification === "verified");
  const contractor = inv?.claims.find((c) => c.field === "contractor" && c.verification === "verified");
  const det = inv?.determination;
  const completion = inv?.claims.find((c) => c.field === "completion_date" && c.verification === "verified");

  const nodes: Node[] = [
    {
      label: "Report",
      title: caseData.id,
      detail: `${caseData.location.lat.toFixed(4)}, ${caseData.location.lng.toFixed(4)}`,
      established: true,
    },
    {
      // The photograph's own edge: what it was found to show, and nothing more than that.
      label: "Photograph",
      title: !caseData.photos.length
        ? "None submitted"
        : det?.fieldCondition.value === "DEFECT_OBSERVED"
          ? "Damage visible"
          : det?.fieldCondition.value === "NO_DEFECT_OBSERVED"
            ? "No damage visible"
            : det?.fieldCondition.value === "HUMAN_REVIEW"
              ? "Needs a person to look"
              : "Not enough to assess",
      detail: caseData.photos.length ? `${caseData.photos.length} on file · establishes condition, not cause` : "Condition on the ground not documented",
      established: caseData.photos.length > 0 && det?.fieldCondition.value === "DEFECT_OBSERVED",
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
      // Which of the project's own facts these documents actually establish, named one by one.
      detail:
        ([contractor && "contractor", completion && "completion date", agency && "agency"].filter(Boolean) as string[]).length > 0
          ? `Establishes ${([contractor && "contractor", completion && "completion date", agency && "agency"].filter(Boolean) as string[]).join(", ")}`
          : "Nothing established word for word yet",
      established: verifiedDocs.size > 0,
    },
    {
      label: "Responsible authority",
      title: agency?.value ?? project?.authorityName ?? "Not established",
      detail: agency ? "Verified in the records" : project?.authorityName ? "From the authority directory" : "Ask via RTI",
      established: Boolean(agency),
    },
    {
      // Where identity, the contract, the ground and the scope meet. Derived by code from the four
      // axes, never by a model, and never a statement about who is responsible.
      label: "Determination",
      title: det ? OVERALL[det.overall.value].label : "Not yet determined",
      detail: det
        ? det.requiresHumanReview
          ? "A person must review this"
          : "Identity, contract, ground and scope combined"
        : "Run the investigation",
      established: det?.overall.value === "POTENTIAL_ISSUE" || det?.overall.value === "SUPPORTED",
    },
    {
      label: "Case",
      title: STATUS_LABELS[caseData.status],
      detail: inv?.nextActions[0]?.title ?? "Awaiting investigation",
      established: caseData.status !== "reported",
    },
  ];

  return (
    <ol className="relative grid gap-3 md:grid-cols-7 md:gap-0">
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

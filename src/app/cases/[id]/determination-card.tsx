import { Fragment } from "react";
import type { ClaimField, Determination, PublicCase } from "@/lib/schemas";
import { CATEGORY_LABELS } from "@/lib/schemas";
import { humanReviewReasons } from "@/lib/agent/determination";
import { sourceHref } from "@/components/evidence";
import { cn } from "@/lib/utils";

/**
 * The four determinations, above the fold.
 *
 * Each axis stands on its own and says why. The wording is deliberately careful: an open
 * defect-liability period is a fact about a contract, never a statement about who is at fault. The
 * overall state is derived from the three axes by code, not by a model.
 */

type Tone = "verified" | "partial" | "missing" | "neutral" | "accent";

const TONE: Record<Tone, string> = {
  verified: "bg-verified-soft text-verified",
  partial: "bg-partial-soft text-partial",
  missing: "bg-missing-soft text-ink-3",
  neutral: "bg-paper-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
};

export const OVERALL: Record<Determination["overall"]["value"], { label: string; tone: Tone; blurb: string }> = {
  POTENTIAL_ISSUE: {
    label: "Potential contractual issue",
    tone: "partial",
    blurb: "The records place an observed defect inside a maintenance obligation that is still open. A person must review this; it does not establish who is responsible.",
  },
  SUPPORTED: {
    label: "Supported by the records",
    tone: "verified",
    blurb: "The project, its obligations and the condition on the ground are all established, and together they raise no open contractual question.",
  },
  UNKNOWN: {
    label: "Unknown — evidence is incomplete",
    tone: "missing",
    blurb: "Something required is missing or unverified. CivicProof does not guess what it could not establish.",
  },
  UNVERIFIED: {
    label: "Project not established",
    tone: "missing",
    blurb: "Until the project this report concerns is established, nothing downstream has been assessed.",
  },
};

const IDENTITY: Record<Determination["identity"]["value"], { label: string; tone: Tone }> = {
  VERIFIED: { label: "Verified", tone: "verified" },
  UNVERIFIED: { label: "Not established", tone: "missing" },
  CODE_MATCHES_MULTIPLE_PROJECTS: { label: "Several projects share this number", tone: "partial" },
};

const IDENTITY_METHOD: Record<Determination["identity"]["method"], string> = {
  job_code: "from the work number on the project board",
  manual_job_code: "from the work number the reporter entered",
  verified_record: "from the work number confirmed in the project's own records",
  road_name: "suggested by the road name",
  geographic: "suggested by the location",
  none: "no project matched",
};

const CONTRACTUAL: Record<Determination["contractualStatus"]["value"], { label: string; tone: Tone }> = {
  ACTIVE: { label: "Maintenance period open", tone: "partial" },
  EXPIRED: { label: "Maintenance period ended", tone: "neutral" },
  UNKNOWN: { label: "Not established", tone: "missing" },
};

const SCOPE: Record<Determination["scopeRelationship"]["value"], { label: string; tone: Tone }> = {
  POTENTIALLY_RELATED: { label: "Possibly within this contract", tone: "partial" },
  NOT_ESTABLISHED: { label: "Not connected by the records", tone: "neutral" },
  UNKNOWN: { label: "Not established", tone: "missing" },
};

/** The amounts a contract record can state, most specific first. */
const MONEY_LABEL: Partial<Record<ClaimField, string>> = {
  contract_value: "Contract value",
  sanctioned_cost: "Sanctioned cost",
  estimated_cost: "Estimated cost",
  maintenance_cost: "Maintenance cost",
};
const MONEY_ORDER: ClaimField[] = ["contract_value", "sanctioned_cost", "estimated_cost", "maintenance_cost"];

export function DeterminationCard({ caseData }: { caseData: PublicCase }) {
  const d = caseData.investigation?.determination;
  if (!d || caseData.investigation?.status !== "complete") return null;
  const overall = OVERALL[d.overall.value];
  const identity = IDENTITY[d.identity.value];
  const claims = caseData.investigation.claims;

  // The claims the window was actually computed from, so the arithmetic can be checked rather than
  // taken on trust. These are the ids the determination recorded, not a fresh search by field.
  const basis = (d.contractualStatus.basedOnClaimIds ?? [])
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const judgedOn = caseData.investigation.finishedAt?.slice(0, 10);
  const reviewReasons = humanReviewReasons(d, claims);

  // Contractor is displayed as a recorded project fact. It is deliberately not an input to the
  // verdict above: who held the contract is not evidence about who caused a defect, and gating the
  // verdict on it would suppress real issues on exactly the projects with the thinnest records.
  const contractor = claims.find((c) => c.field === "contractor" && c.origin === "official_record");
  const contractorState: { label: string; tone: Tone; reason: string } =
    d.identity.value !== "VERIFIED"
      ? { label: "Not established", tone: "missing", reason: "The project this report concerns is not established, so no contractor is attributed to it." }
      : !contractor
        ? { label: "Not established", tone: "missing", reason: "No document on file names a contractor for this project. The work order or contract agreement would state it." }
        : contractor.verification === "verified"
          ? {
              label: contractor.value ?? contractor.text,
              tone: "verified",
              reason: "Named in the official record cited on this page. This records who was contracted for the work; it does not establish who is responsible for the defect.",
            }
          : contractor.verification === "contradicted"
            ? {
                // Records disagreeing is a different fact from a quote failing to match, and saying
                // the wrong one would itself be an unsupported statement.
                label: "Records disagree",
                tone: "partial",
                reason: "More than one contractor is named for this project across the records on file. Both are listed in the evidence below; neither has been chosen.",
              }
            : {
                label: contractor.value ?? contractor.text,
                tone: "partial",
                reason: "A record names this contractor, but the name could not be confirmed word for word on the page cited, so it is not treated as established.",
              };

  // PROJECT IDENTIFICATION: the name, number, agency and the evidence that establishes them.
  // The project_id claim is what identity rests on, so its citation is shown here rather than left
  // to be hunted for in the ledger below.
  const inv = caseData.investigation;
  const linked = inv.matches.find((m) => m.projectId === inv.selectedProjectId);
  const idClaim = claims.find((c) => c.field === "project_id" && c.origin === "official_record");
  const idEvidence = (idClaim?.evidenceIds ?? [])
    .map((eid) => inv.evidence.find((e) => e.id === eid))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const agencyClaim = claims.find((c) => c.field === "agency" && c.origin === "official_record");

  // DEFECT LIABILITY: completion + duration + start + end + the date it was judged on. Every value
  // is read back from the claims the window was computed from, never recalculated here.
  const window = claims.find((c) => c.field === "maintenance_window" && c.origin === "computed");
  const completionClaim = basis.find((c) => c.field === "completion_date");
  const dlpClaim = basis.find((c) => c.field === "defect_liability");
  const dlpEvidence = (c: (typeof claims)[number] | undefined) =>
    (c?.evidenceIds ?? []).map((eid) => inv.evidence.find((e) => e.id === eid)).filter((e): e is NonNullable<typeof e> => Boolean(e))[0];

  // PHOTOGRAPH: the gate's verdict on the file, then what was read from it. Those are two
  // different questions and the page keeps them apart: an unusable file is never interpreted, and
  // an interpretation is the reporter's own evidence, not a public record.
  const shot = caseData.photos[0];
  const gateFailed = Boolean(d.fieldCondition.recapture);
  // SCOPE: the claims the relationship was actually grounded in, with the page each was read from.
  // Amounts the records state. A figure whose unit was never established cannot reach "verified",
  // so anything shown here carries its unit.
  const money = MONEY_ORDER.map((f) => claims.find((c) => c.field === f && c.verification === "verified" && c.origin === "official_record")).filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );

  const scopeBasis = (d.scopeRelationship.basedOnClaimIds ?? [])
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const photoState: { label: string; tone: Tone; detail: string } = !shot
    ? { label: "None submitted", tone: "missing", detail: "The condition on the ground is not documented." }
    : gateFailed
      ? { label: "Not usable", tone: "missing", detail: d.fieldCondition.reason.replace(/^The photograph is not sufficient to assess the condition: /, "") }
      : {
          label: "Usable",
          tone: "verified",
          detail: [shot.width && shot.height ? `${shot.width}×${shot.height}` : "dimensions read from the file", `${Math.round(shot.bytes / 1024)} KB`].join(" · "),
        };
  const observationState: { label: string; tone: Tone } =
    !shot || gateFailed
      ? { label: "Not interpreted", tone: "missing" }
      : d.fieldCondition.value === "DEFECT_OBSERVED"
        ? { label: "Visible infrastructure defect", tone: "partial" }
        : d.fieldCondition.value === "NO_DEFECT_OBSERVED"
          ? { label: "No visible defect", tone: "neutral" }
          : d.fieldCondition.value === "HUMAN_REVIEW"
            ? { label: "Unclear — a person must look", tone: "partial" }
            : { label: "Not interpreted", tone: "missing" };

  return (
    <section aria-labelledby="determination-heading" className="mt-8">
      <div className="overflow-hidden rounded-xl border border-rule-strong bg-card">
        {/* What the five kinds of statement on this page look like, said once, in plain words. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-b border-rule bg-paper-2 px-4 py-2.5 text-[12px] sm:px-5">
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-verified" aria-hidden />Verified fact — quoted from a cited page</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-rule-strong" aria-hidden />Citizen observation — the reporter&rsquo;s own evidence</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" aria-hidden />System determination — worked out by CivicProof</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rule-strong" aria-hidden />Missing evidence — not on file</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-partial" aria-hidden />Human review required</li>
        </ul>

        {/* The photograph, and what was read from it. Kept apart from the records above. */}
        <section aria-labelledby="photo-heading" className="space-y-2.5 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p id="photo-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Photograph and citizen observation</p>
            <span className="rounded-full border border-dashed border-rule-strong px-2 py-0.5 text-[12px] text-ink-3">Reporter&rsquo;s evidence, not a public record</span>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[192px_1fr]">
            <dt className="text-ink-3">Photograph</dt>
            <dd>
              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[12.5px] font-medium", TONE[photoState.tone])}>{photoState.label}</span>
              <span className="ml-2 text-ink-2">{photoState.detail}</span>
            </dd>

            <dt className="text-ink-3">Observation</dt>
            <dd>
              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[12.5px] font-medium", TONE[observationState.tone])}>{observationState.label}</span>
              {!gateFailed && shot && (d.fieldCondition.value === "DEFECT_OBSERVED" || d.fieldCondition.value === "NO_DEFECT_OBSERVED" || d.fieldCondition.value === "HUMAN_REVIEW") && (
                <span className="ml-2 text-ink-2">{d.fieldCondition.reason}</span>
              )}
              {!shot && <span className="ml-2 text-ink-3">There is no photograph to read.</span>}
              {shot && gateFailed && <span className="ml-2 text-ink-3">A photograph the checks did not accept is never interpreted.</span>}
              {shot && !gateFailed && d.fieldCondition.value === "INSUFFICIENT_EVIDENCE" && (
                <span className="ml-2 text-ink-3">The photograph passed the checks, but nothing has read it yet.</span>
              )}
            </dd>
          </dl>

          {d.fieldCondition.recapture && (
            <p className="max-w-2xl rounded-lg bg-partial-soft/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{d.fieldCondition.recapture}</p>
          )}

          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
            What a photograph shows is the reporter&rsquo;s own evidence about the condition of the road on the day it was taken. It is
            not a public record, it is not checked against one, and it does not establish who is responsible for that condition.
          </p>
        </section>

        {/* Identity, which gates everything above it. */}
        <section aria-labelledby="identity-heading" className="space-y-1.5 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p id="identity-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Project identification</p>
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[13px] font-medium", TONE[identity.tone])}>{identity.label}</span>
            <span className="text-[12px] text-ink-3">{IDENTITY_METHOD[d.identity.method]}</span>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[132px_1fr]">
            <dt className="text-ink-3">Project</dt>
            <dd className="text-ink">{linked?.projectName ?? "Not identified"}</dd>

            <dt className="text-ink-3">Work number</dt>
            <dd className="font-mono text-ink">
              {/* Only a code that survived validation belongs in this slot. A rejected one shown
                  here reads as the number that was confirmed, which is the opposite of what
                  happened; the reason below still quotes exactly what was supplied. */}
              {d.identity.normalizedCode && d.identity.patternValid !== false ? d.identity.normalizedCode : <span className="font-sans text-ink-3">Not recorded</span>}
            </dd>

            <dt className="text-ink-3">Agency</dt>
            <dd className="text-ink">{agencyClaim?.value ?? agencyClaim?.text ?? <span className="text-ink-3">Not established</span>}</dd>

            <dt className="text-ink-3">Evidence</dt>
            <dd className="text-ink-2">
              {idEvidence.length ? (
                <ul className="space-y-0.5">
                  {idEvidence.map((e) => (
                    <li key={e.id}>
                      <a href={sourceHref(e)} className="underline decoration-rule-strong underline-offset-4 hover:text-accent">
                        {e.sourceTitle}
                        {e.page !== undefined ? `, p. ${e.page}` : ""}
                      </a>
                      <span className="text-ink-3"> — work number quoted word for word</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-ink-3">
                  {d.identity.value === "CODE_MATCHES_MULTIPLE_PROJECTS"
                    ? `The number is recorded against ${d.identity.candidateProjectIds?.length ?? 0} separate works; until one is chosen, none of their records is evidence about this report.`
                    : "No record on file ties a work number to this report."}
                </span>
              )}
            </dd>
          </dl>

          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{d.identity.reason}</p>
          {d.identity.value === "CODE_MATCHES_MULTIPLE_PROJECTS" && d.identity.candidateProjectIds?.length ? (
            <p className="text-[12.5px] text-ink-3">
              {d.identity.candidateProjectIds.length} projects carry this number. One of them has to be chosen before the contractual
              checks mean anything — the candidates are listed below, nearest first.
            </p>
          ) : null}
        </section>

        {/* Contractor: a recorded project fact, shown beside identity and never feeding the verdict. */}
        <section aria-labelledby="contractor-heading" className="space-y-1.5 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p id="contractor-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Contractor</p>
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[13px] font-medium", TONE[contractorState.tone])}>{contractorState.label}</span>
          </div>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{contractorState.reason}</p>
        </section>

        {/* Contract information: the amounts the records state, with the unit they state them in. */}
        <section aria-labelledby="contract-heading" className="space-y-1.5 border-t border-rule px-4 py-4 sm:px-5">
          <p id="contract-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Contract information</p>
          {money.length ? (
            <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[192px_1fr]">
              {money.map((c) => {
                const ev = (c.evidenceIds ?? []).map((eid) => inv.evidence.find((e) => e.id === eid)).find(Boolean);
                return (
                  <Fragment key={c.id}>
                    <dt className="text-ink-3">{MONEY_LABEL[c.field] ?? c.field}</dt>
                    <dd className="text-ink">
                      <span className="font-mono">{c.value ?? c.text}</span>
                      {ev && (
                        <a href={sourceHref(ev)} className="ml-2 text-[12px] text-ink-3 underline decoration-rule-strong underline-offset-4 hover:text-accent">
                          {ev.sourceTitle}
                          {ev.page !== undefined ? `, p. ${ev.page}` : ""}
                        </a>
                      )}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          ) : (
            <p className="text-[13px] text-ink-3">
              No contract value or sanctioned cost is established in this project&rsquo;s records. The work order or contract agreement
              would state it.
            </p>
          )}
        </section>

        {/* The defect-liability period in full: what it was computed from, when it runs, and the
            boundary that an open period is context about a contract and not a finding about a
            person. Shown whenever there is a status to report, including UNKNOWN. */}
        <section aria-labelledby="dlp-heading" className="space-y-2.5 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p id="dlp-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Defect liability / maintenance period</p>
            <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold tracking-wide", TONE[CONTRACTUAL[d.contractualStatus.value].tone])}>
              DLP STATUS: {d.contractualStatus.value}
            </span>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[192px_1fr]">
            <dt className="text-ink-3">Recorded completion date</dt>
            <dd className="text-ink">
              {completionClaim ? (
                <>
                  <span className="font-mono">{completionClaim.value ?? completionClaim.text}</span>
                  {dlpEvidence(completionClaim) && (
                    <a href={sourceHref(dlpEvidence(completionClaim)!)} className="ml-2 text-[12px] text-ink-3 underline decoration-rule-strong underline-offset-4 hover:text-accent">
                      {dlpEvidence(completionClaim)!.sourceTitle}
                      {dlpEvidence(completionClaim)!.page !== undefined ? `, p. ${dlpEvidence(completionClaim)!.page}` : ""}
                    </a>
                  )}
                </>
              ) : (
                <span className="text-ink-3">Not established by the records</span>
              )}
            </dd>

            <dt className="text-ink-3">Maintenance duration</dt>
            <dd className="text-ink">
              {dlpClaim ? (
                <>
                  <span className="font-mono">{dlpClaim.value ?? dlpClaim.text}</span>
                  {dlpEvidence(dlpClaim) && (
                    <a href={sourceHref(dlpEvidence(dlpClaim)!)} className="ml-2 text-[12px] text-ink-3 underline decoration-rule-strong underline-offset-4 hover:text-accent">
                      {dlpEvidence(dlpClaim)!.sourceTitle}
                      {dlpEvidence(dlpClaim)!.page !== undefined ? `, p. ${dlpEvidence(dlpClaim)!.page}` : ""}
                    </a>
                  )}
                </>
              ) : (
                <span className="text-ink-3">Not established by the records</span>
              )}
            </dd>

            <dt className="text-ink-3">DLP start date</dt>
            <dd className="text-ink">
              {completionClaim && d.contractualStatus.windowEnd ? (
                <>
                  <span className="font-mono">{completionClaim.value ?? completionClaim.text}</span>
                  <span className="ml-2 text-[12px] text-ink-3">the recorded completion date</span>
                </>
              ) : (
                <span className="text-ink-3">Cannot be placed without a verified completion date</span>
              )}
            </dd>

            <dt className="text-ink-3">DLP end date</dt>
            <dd className="text-ink">
              {d.contractualStatus.windowEnd ? (
                <>
                  <span className="font-mono">{d.contractualStatus.windowEnd}</span>
                  {window?.notes && <span className="ml-2 text-[12px] text-ink-3">{window.notes.split(".")[0]}</span>}
                </>
              ) : (
                <span className="text-ink-3">Not computed</span>
              )}
            </dd>

            <dt className="text-ink-3">Evaluated on</dt>
            <dd className="text-ink">
              <span className="font-mono">{judgedOn ?? "—"}</span>
              {d.contractualStatus.observationInsideWindow !== undefined && (
                <span className="ml-2 text-[12px] text-ink-3">
                  issue observed {caseData.observedOn}, {d.contractualStatus.observationInsideWindow ? "inside" : "outside"} the period
                </span>
              )}
            </dd>
          </dl>

          {d.contractualStatus.value === "ACTIVE" ? (
            <p className="max-w-2xl rounded-lg bg-paper-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
              An active DLP provides contractual/maintenance context. It does not by itself establish who is responsible for the
              observed defect.
            </p>
          ) : null}
        </section>

        {/* How the reported issue sits against the scope the records actually document. The
            comparison is only made where a scope record was verified inside this project's own
            bundle; otherwise the panel says what is missing instead of reaching for a verdict. */}
        <section aria-labelledby="scope-heading" className="space-y-2.5 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p id="scope-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Scope relationship</p>
            <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold tracking-wide", TONE[SCOPE[d.scopeRelationship.value].tone])}>
              {d.scopeRelationship.value.replace(/_/g, " ")}
            </span>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[192px_1fr]">
            <dt className="text-ink-3">Documented scope</dt>
            <dd className="text-ink">
              {scopeBasis.length ? (
                <ul className="space-y-0.5">
                  {scopeBasis.map((c) => {
                    const ev = (c.evidenceIds ?? []).map((eid) => inv.evidence.find((e) => e.id === eid)).find(Boolean);
                    return (
                      <li key={c.id}>
                        {/* The claim sentence, not the bare value: a scope recorded as "4.250 km"
                            is a length, and only the sentence around it says what work it describes. */}
                        <span>{c.text}</span>
                        {ev && (
                          <a href={sourceHref(ev)} className="ml-2 text-[12px] text-ink-3 underline decoration-rule-strong underline-offset-4 hover:text-accent">
                            {ev.sourceTitle}
                            {ev.page !== undefined ? `, p. ${ev.page}` : ""}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="text-ink-3">No scope of work is established in this project&rsquo;s own records.</span>
              )}
            </dd>

            <dt className="text-ink-3">Reported condition</dt>
            <dd className="text-ink">
              {CATEGORY_LABELS[caseData.category]}
              <span className="ml-2 text-[12px] text-ink-3">at {caseData.location.locality ?? caseData.location.address ?? "the reported pin"}</span>
            </dd>
          </dl>

          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-2">
            {d.scopeRelationship.value === "POTENTIALLY_RELATED"
              ? "The available project record documents work on this road/section, and the reported location corresponds to that documented scope. This supports a potential relationship between the reported condition and the project scope. It does not establish causation or responsibility."
              : d.scopeRelationship.value === "NOT_ESTABLISHED"
                ? "The project's records document work of a different kind from the condition reported here, so the records do not connect the two. That is a statement about the records, not a finding that the project is unrelated."
                : "The comparison has not been made: the records needed to describe what work this project covers are not established, so whether the reported condition falls inside that work is unknown. A project being nearby is not enough to place a defect inside its scope."}
          </p>
        </section>

        {/* The verdict, first and in plain words. */}
        <div className="space-y-2 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="determination-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              What the evidence establishes
            </h2>
            {d.requiresHumanReview && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-partial-soft px-2 py-0.5 text-[12px] font-medium text-partial">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                Human review required
              </span>
            )}
          </div>
          <p className={cn("inline-flex rounded-full px-2.5 py-1 text-[15px] font-medium", TONE[overall.tone])}>{overall.label}</p>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{d.overall.reason}</p>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{overall.blurb}</p>
        </div>

        {/* Why a person is being asked to look, and what would settle it — so the flag is a request
            with a reason attached rather than a shrug. */}
        {d.requiresHumanReview && reviewReasons.length > 0 && (
          <div className="border-b border-rule bg-partial-soft/40 px-4 py-3.5 sm:px-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Why a person needs to look</p>
            <ul className="mt-2 max-w-2xl space-y-2">
              {reviewReasons.map((r, i) => (
                <li key={i} className="text-[12.5px] leading-relaxed text-ink-2">
                  {r.why} <span className="text-ink-3">What would settle it: {r.resolvedBy}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Completeness, stated as a checklist count and explicitly not a score. The photograph is
            not counted here: it is not a record anyone can be asked to produce, and the panel above
            reports it in full. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-rule bg-paper-2 px-4 py-3 sm:px-5">
          <p className="text-[12.5px] text-ink-2">
            Evidence completeness <span className="font-mono text-ink">{d.completeness.have} of {d.completeness.of}</span> records we check for
          </p>
          <p className="text-[12px] text-ink-3">Not a confidence or truth score — it counts records on file, nothing more.</p>
        </div>

        {/* The safety boundary, stated where the verdict is read. */}
        <p className="border-t border-rule px-4 py-2.5 text-[12px] leading-relaxed text-ink-3 sm:px-5">
          A model reads and proposes; deterministic code decides. Only facts quoted word for word from a cited page become verified,
          and nothing here establishes who is responsible for the condition of the road.
        </p>
      </div>
    </section>
  );
}

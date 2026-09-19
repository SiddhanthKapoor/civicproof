import type { Determination, PublicCase } from "@/lib/schemas";
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

const OVERALL: Record<Determination["overall"]["value"], { label: string; tone: Tone; blurb: string }> = {
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

const FIELD: Record<Determination["fieldCondition"]["value"], { label: string; tone: Tone }> = {
  DEFECT_OBSERVED: { label: "Damage visible", tone: "partial" },
  NO_DEFECT_OBSERVED: { label: "No damage visible", tone: "neutral" },
  INSUFFICIENT_EVIDENCE: { label: "Not enough to assess", tone: "missing" },
  HUMAN_REVIEW: { label: "Needs a person to look", tone: "partial" },
};

const SCOPE: Record<Determination["scopeRelationship"]["value"], { label: string; tone: Tone }> = {
  POTENTIALLY_RELATED: { label: "Possibly within this contract", tone: "partial" },
  NOT_ESTABLISHED: { label: "Not connected by the records", tone: "neutral" },
  UNKNOWN: { label: "Not established", tone: "missing" },
};

function Axis({ title, label, tone, reason, children }: { title: string; label: string; tone: Tone; reason: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-rule pt-3 first:border-0 first:pt-0 sm:border-0 sm:border-l sm:pt-0 sm:pl-4 sm:first:pl-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{title}</p>
      <p className={cn("inline-flex rounded-full px-2 py-0.5 text-[13px] font-medium", TONE[tone])}>{label}</p>
      <p className="text-[12.5px] leading-relaxed text-ink-3">{reason}</p>
      {children}
    </div>
  );
}

export function DeterminationCard({ caseData }: { caseData: PublicCase }) {
  const d = caseData.investigation?.determination;
  if (!d || caseData.investigation?.status !== "complete") return null;
  const overall = OVERALL[d.overall.value];
  const identity = IDENTITY[d.identity.value];

  return (
    <section aria-labelledby="determination-heading" className="mt-8">
      <div className="overflow-hidden rounded-xl border border-rule-strong bg-card">
        {/* The verdict, first and in plain words. */}
        <div className="space-y-2 border-b border-rule px-4 py-4 sm:px-5">
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

        {/* The three axes it was derived from, each standing on its own. */}
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-3 sm:px-5">
          <Axis title="Contract" label={CONTRACTUAL[d.contractualStatus.value].label} tone={CONTRACTUAL[d.contractualStatus.value].tone} reason={d.contractualStatus.reason}>
            {d.contractualStatus.windowEnd && (
              <p className="font-mono text-[12px] text-ink-3">
                runs to {d.contractualStatus.windowEnd}
                {d.contractualStatus.observationInsideWindow !== undefined &&
                  ` · issue observed ${d.contractualStatus.observationInsideWindow ? "inside" : "outside"} it`}
              </p>
            )}
          </Axis>
          <Axis title="On the ground" label={FIELD[d.fieldCondition.value].label} tone={FIELD[d.fieldCondition.value].tone} reason={d.fieldCondition.reason}>
            {d.fieldCondition.recapture && <p className="text-[12.5px] text-partial">{d.fieldCondition.recapture}</p>}
          </Axis>
          <Axis title="Scope" label={SCOPE[d.scopeRelationship.value].label} tone={SCOPE[d.scopeRelationship.value].tone} reason={d.scopeRelationship.reason} />
        </div>

        {/* Identity, which gates everything above it. */}
        <div className="space-y-1.5 border-t border-rule px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Project identity</p>
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[13px] font-medium", TONE[identity.tone])}>{identity.label}</span>
            {d.identity.normalizedCode && <span className="font-mono text-[12px] text-ink-3">{d.identity.normalizedCode}</span>}
            <span className="text-[12px] text-ink-3">{IDENTITY_METHOD[d.identity.method]}</span>
          </div>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{d.identity.reason}</p>
          {d.identity.value === "CODE_MATCHES_MULTIPLE_PROJECTS" && d.identity.candidateProjectIds?.length ? (
            <p className="text-[12.5px] text-ink-3">
              {d.identity.candidateProjectIds.length} projects carry this number. One of them has to be chosen before the contractual
              checks mean anything — the candidates are listed below, nearest first.
            </p>
          ) : null}
        </div>

        {/* Completeness, stated as a checklist count and explicitly not a score. */}
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

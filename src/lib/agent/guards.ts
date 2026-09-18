/**
 * Neutral-language guard (a Strands intervention). CivicProof documents; it does not accuse.
 * If the model tries to write an accusation into a finding or summary, the call is
 * cancelled and the model is steered to rephrase in terms of what the records say.
 */
import { InterventionHandler, type BeforeToolCallEvent } from "@strands-agents/sdk";

const ACCUSATORY =
  /\b(corrupt(ion|ed)?|fraud(ulent)?|scam|embezzl\w*|siphon\w*|loot(ed|ing)?|brib\w*|kickbacks?|criminal|guilty|cheat(ed|ing)?|misappropriat\w*|swindl\w*|scandal|mafia|shoddy|deliberately)\b/i;

const GUARDED_TOOLS = new Set(["record_claim", "finish", "propose_next_action", "flag_missing"]);

export function findAccusatoryLanguage(text: string): string | undefined {
  return text.match(ACCUSATORY)?.[0];
}

export class NeutralLanguageGuard extends InterventionHandler {
  readonly name = "neutral-language";

  constructor(private onBlocked?: (tool: string, term: string) => void) {
    super();
  }

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (!GUARDED_TOOLS.has(event.toolUse.name)) return { type: "proceed" as const };
    // Only the model's own words are checked; verbatim quotes from official records
    // (e.g. an audit report finding) are evidence, not allegations.
    const input = (event.toolUse.input ?? {}) as Record<string, unknown>;
    const text = ["text", "summary", "analysis", "rationale", "reason", "title", "notes"]
      .map((k) => (typeof input[k] === "string" ? (input[k] as string) : ""))
      .join(" ");
    const term = findAccusatoryLanguage(text);
    if (!term) return { type: "proceed" as const };
    this.onBlocked?.(event.toolUse.name, term);
    return {
      type: "guide" as const,
      feedback: `The word "${term}" makes an allegation the records do not establish. Rephrase neutrally: state what the official record says, what the citizen reported, and what could not be verified. Then call ${event.toolUse.name} again.`,
    };
  }
}

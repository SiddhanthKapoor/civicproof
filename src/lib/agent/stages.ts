/** Investigation stages, shared by the agent (server) and the live progress UI (client). */
export const STAGES = [
  { id: "intake", label: "Read the report" },
  { id: "locate", label: "Find projects at this location" },
  { id: "retrieve", label: "Retrieve official records" },
  { id: "extract", label: "Extract and verify facts" },
  { id: "gaps", label: "Identify missing information" },
  { id: "action", label: "Recommend next action" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

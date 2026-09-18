import "server-only";
import { config } from "@/lib/config";
import { DynamoCaseStore } from "./dynamo";
import { LocalCaseStore } from "./local";
import type { CaseStore } from "./types";

export * from "./types";

let instance: CaseStore | undefined;

export function getStore(): CaseStore {
  if (!instance) {
    instance = config.store === "dynamodb" ? new DynamoCaseStore(config.tableName) : new LocalCaseStore(config.dataDir);
  }
  return instance;
}

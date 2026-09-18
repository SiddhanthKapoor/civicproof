/**
 * DynamoDB single-table store.
 *
 *   PK = CASE#<id>        SK = CASE     full case document (attribute `doc`) + version
 *   GSI1PK = CASES        GSI1SK = <reportedAt>#<id>   → newest-first listing
 *   PK = COUNTER#<name>   SK = COUNTER  atomic counters (daily Bedrock budget), TTL-expired
 *
 * Updates use optimistic concurrency on `version`, retried a few times on conflict.
 */
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CaseSchema, type Case } from "@/lib/schemas";
import { ConflictError, NotFoundError, summarize, type CaseStore, type CaseSummary } from "./types";

export class DynamoCaseStore implements CaseStore {
  private doc: DynamoDBDocumentClient;

  constructor(
    private table: string,
    client?: DynamoDBClient,
  ) {
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private item(c: Case, version: number) {
    const s = summarize(c);
    return {
      PK: `CASE#${c.id}`,
      SK: "CASE",
      GSI1PK: "CASES",
      GSI1SK: `${c.reportedAt}#${c.id}`,
      version,
      summary: s,
      doc: JSON.stringify(c),
    };
  }

  private async getWithVersion(id: string): Promise<{ c: Case; version: number } | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: `CASE#${id}`, SK: "CASE" }, ConsistentRead: true }),
    );
    if (!res.Item) return null;
    return { c: CaseSchema.parse(JSON.parse(res.Item.doc as string)), version: Number(res.Item.version ?? 0) };
  }

  async get(id: string): Promise<Case | null> {
    return (await this.getWithVersion(id))?.c ?? null;
  }

  async create(c: Case): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: this.item(CaseSchema.parse(c), 1),
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  }

  async update(id: string, mutate: (c: Case) => Case): Promise<Case> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.getWithVersion(id);
      if (!current) throw new NotFoundError();
      const next = CaseSchema.parse(mutate(structuredClone(current.c)));
      next.updatedAt = new Date().toISOString();
      try {
        await this.doc.send(
          new PutCommand({
            TableName: this.table,
            Item: this.item(next, current.version + 1),
            ConditionExpression: "version = :v",
            ExpressionAttributeValues: { ":v": current.version },
          }),
        );
        return next;
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) {
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    throw new ConflictError();
  }

  async list(limit = 200): Promise<CaseSummary[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :p",
        ExpressionAttributeValues: { ":p": "CASES" },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => i.summary as CaseSummary);
  }

  async increment(counter: string, ttlSeconds: number): Promise<number> {
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: `COUNTER#${counter}`, SK: "COUNTER" },
        UpdateExpression: "ADD #n :one SET expiresAt = if_not_exists(expiresAt, :exp)",
        ExpressionAttributeNames: { "#n": "count" },
        ExpressionAttributeValues: { ":one": 1, ":exp": Math.floor(Date.now() / 1000) + ttlSeconds },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(res.Attributes?.count ?? 0);
  }
}

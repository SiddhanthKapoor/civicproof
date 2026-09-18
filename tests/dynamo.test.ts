/**
 * The DynamoDB store against dynalite (a local DynamoDB implementation): same table layout as
 * infra/template.yaml, optimistic locking under concurrent updates, GSI listing, atomic counters.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
// @ts-expect-error dynalite has no types
import dynalite from "dynalite";
import { DynamoCaseStore } from "@/lib/store/dynamo";
import type { Case } from "@/lib/schemas";

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let store: DynamoCaseStore;

function makeCase(id: string, reportedAt: string): Case {
  return {
    id,
    title: "Test case title",
    description: "A description that is long enough.",
    category: "pothole",
    location: { lat: 12.9, lng: 77.6, source: "map_pin" },
    observedOn: "2026-09-10",
    reportedAt,
    updatedAt: reportedAt,
    photos: [],
    status: "reported",
    demo: false,
    ownerKeyHash: "a".repeat(64),
    packets: {},
    documents: [],
    timeline: [],
  };
}

beforeAll(async () => {
  server = dynalite({ createTableMs: 0 });
  await new Promise<void>((r) => server.listen(0, r));
  const client = new DynamoDBClient({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    region: "ap-south-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  await client.send(
    new CreateTableCommand({
      TableName: "civicproof-test",
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "INCLUDE", NonKeyAttributes: ["summary"] },
        },
      ],
    }),
  );
  store = new DynamoCaseStore("civicproof-test", client);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(r));
});

describe("DynamoCaseStore", () => {
  it("creates, reads and refuses duplicates", async () => {
    await store.create(makeCase("CP-AAAA-0001", "2026-09-18T01:00:00.000Z"));
    const c = await store.get("CP-AAAA-0001");
    expect(c?.title).toBe("Test case title");
    await expect(store.create(makeCase("CP-AAAA-0001", "2026-09-18T01:00:00.000Z"))).rejects.toThrow();
  });

  it("keeps every concurrent update (optimistic locking with retries)", async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.update("CP-AAAA-0001", (c) => ({
          ...c,
          timeline: [...c.timeline, { id: `ev${i}`, at: new Date().toISOString(), type: "note" as const, actor: "reporter" as const, summary: `n${i}` }],
        })),
      ),
    );
    const c = await store.get("CP-AAAA-0001");
    expect(c?.timeline).toHaveLength(5);
  });

  it("lists newest first through the GSI", async () => {
    await store.create(makeCase("CP-AAAA-0002", "2026-09-18T02:00:00.000Z"));
    const list = await store.list();
    expect(list.map((c) => c.id)).toEqual(["CP-AAAA-0002", "CP-AAAA-0001"]);
  });

  it("increments counters atomically", async () => {
    const values = await Promise.all(Array.from({ length: 4 }, () => store.increment("runs:test", 60)));
    expect(values.sort()).toEqual([1, 2, 3, 4]);
  });
});

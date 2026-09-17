import { randomUUID } from "node:crypto";
import {
  AiAssetType,
  AiTaskStatus,
  AiTaskType,
  PrismaClient,
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaUserStore } from "../src/store";

const databaseUrl = process.env.DATABASE_URL;
const fixturePrefix = `pf4e1_canvas_${randomUUID()}_`;

describe.sequential("CreatorCanvasDocument Prisma store regression", () => {
  let prisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;
  const fixtureUserIds: string[] = [];

  function database(): PrismaClient {
    if (!prisma) throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    return prisma;
  }

  function canvasStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) throw new Error("TEST_STORE_NOT_INITIALIZED");
    return store;
  }

  async function cleanup(): Promise<void> {
    if (!prisma || fixtureUserIds.length === 0) return;
    const userIds = [...fixtureUserIds];
    await prisma.aiAsset.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.creatorCanvasDocument.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.aiTask.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.storageObject.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fixtureUserIds.length = 0;
  }

  async function createFixtureUser(label: string): Promise<string> {
    const id = `${fixturePrefix}${label}-${randomUUID()}`;
    await database().user.create({
      data: {
        id,
        email: `${id}@example.test`,
        passwordHash: "test-password-hash"
      }
    });
    fixtureUserIds.push(id);
    return id;
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL_MISSING");
    const parsed = new URL(databaseUrl);
    if (
      parsed.protocol !== "mysql:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "3308" ||
      parsed.pathname !== "/ai_aggregate_s13c1a"
    ) {
      throw new Error("TEST_DATABASE_MUST_BE_LOCAL_DISPOSABLE_S13C1A_MYSQL");
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    store = createPrismaUserStore(prisma);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma?.$disconnect();
    }
  });

  it("proves owner isolation, summary ordering, CAS conflict safety, and delete isolation", async () => {
    const ownerA = await createFixtureUser("owner-a");
    const ownerB = await createFixtureUser("owner-b");
    const initialState = {
      schemaVersion: 1,
      document: { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      imageComposerDrafts: {}
    };
    const replacementState = {
      ...initialState,
      document: { ...initialState.document, viewport: { x: 12, y: -8, zoom: 1.2 } }
    };
    const older = await canvasStore().createCreatorCanvasDocument({
      userId: ownerA,
      title: "Older Canvas",
      state: initialState
    });
    const newer = await canvasStore().createCreatorCanvasDocument({
      userId: ownerA,
      title: "Newer Canvas",
      state: initialState
    });
    await database().creatorCanvasDocument.update({
      where: { id: older.id },
      data: { updatedAt: new Date("2026-09-01T10:00:00.000Z") }
    });
    await database().creatorCanvasDocument.update({
      where: { id: newer.id },
      data: { updatedAt: new Date("2026-09-02T10:00:00.000Z") }
    });

    expect(older.revision).toBe(1);
    expect(newer.revision).toBe(1);
    const summaries = await canvasStore().listCreatorCanvasDocumentsForUser(ownerA);
    expect(summaries.map((summary) => summary.id)).toEqual([newer.id, older.id]);
    expect(summaries[0]).not.toHaveProperty("state");

    expect(await canvasStore().findCreatorCanvasDocumentForUser(ownerA, newer.id))
      .toMatchObject({ id: newer.id, revision: 1, state: initialState });
    expect(await canvasStore().findCreatorCanvasDocumentForUser(ownerB, newer.id))
      .toBeNull();

    await expect(
      canvasStore().updateCreatorCanvasDocument({
        id: newer.id,
        userId: ownerA,
        expectedRevision: 1,
        title: "Renamed Canvas"
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      document: {
        id: newer.id,
        title: "Renamed Canvas",
        revision: 2,
        state: initialState
      }
    });
    const afterTitleOnlyRename = await database().creatorCanvasDocument.findUniqueOrThrow({
      where: { id: newer.id }
    });
    expect(afterTitleOnlyRename.title).toBe("Renamed Canvas");
    expect(afterTitleOnlyRename.revision).toBe(2);
    expect(afterTitleOnlyRename.state).toEqual(initialState);

    await expect(
      canvasStore().updateCreatorCanvasDocument({
        id: newer.id,
        userId: ownerA,
        expectedRevision: 1,
        title: "Stale rename"
      })
    ).resolves.toEqual({ status: "CONFLICT" });
    expect(await canvasStore().findCreatorCanvasDocumentForUser(ownerA, newer.id))
      .toMatchObject({
        revision: 2,
        title: "Renamed Canvas",
        state: initialState
      });

    await expect(
      canvasStore().updateCreatorCanvasDocument({
        id: newer.id,
        userId: ownerA,
        expectedRevision: 2,
        state: replacementState
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      document: {
        id: newer.id,
        revision: 3,
        title: "Renamed Canvas",
        state: replacementState
      }
    });

    const combinedState = {
      ...replacementState,
      document: { ...replacementState.document, combined: true }
    };
    await expect(
      canvasStore().updateCreatorCanvasDocument({
        id: newer.id,
        userId: ownerA,
        expectedRevision: 3,
        state: combinedState,
        title: "Combined Canvas"
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      document: {
        id: newer.id,
        revision: 4,
        title: "Combined Canvas",
        state: combinedState
      }
    });

    await expect(
      canvasStore().updateCreatorCanvasDocument({
        id: newer.id,
        userId: ownerB,
        expectedRevision: 4,
        title: "Intruder"
      })
    ).resolves.toEqual({ status: "NOT_FOUND" });
    expect(await canvasStore().deleteCreatorCanvasDocumentForUser(ownerB, newer.id))
      .toBe(false);
    expect(await canvasStore().findCreatorCanvasDocumentForUser(ownerA, newer.id))
      .toMatchObject({
        revision: 4,
        title: "Combined Canvas",
        state: combinedState
      });

    const storageObjectId = `${fixturePrefix}storage-${randomUUID()}`;
    const taskId = `${fixturePrefix}task-${randomUUID()}`;
    const assetId = `${fixturePrefix}asset-${randomUUID()}`;
    await database().storageObject.create({
      data: {
        id: storageObjectId,
        userId: ownerA,
        storageProvider: StorageProvider.LOCAL,
        objectKey: `users/${ownerA}/${storageObjectId}.png`,
        source: StorageObjectSource.GENERATED,
        status: StorageObjectStatus.READY,
        mimeType: "image/png",
        sizeBytes: 1n,
        sha256: "a".repeat(64)
      }
    });
    await database().aiTask.create({
      data: {
        id: taskId,
        userId: ownerA,
        type: AiTaskType.IMAGE,
        status: AiTaskStatus.SUCCEEDED,
        prompt: "fixture task",
        input: { fixture: true },
        output: { ok: true }
      }
    });
    await database().aiAsset.create({
      data: {
        id: assetId,
        userId: ownerA,
        taskId,
        storageObjectId,
        type: AiAssetType.IMAGE,
        url: `/assets/${assetId}/content`
      }
    });
    const assetBefore = await database().aiAsset.findUniqueOrThrow({ where: { id: assetId } });
    const taskBefore = await database().aiTask.findUniqueOrThrow({ where: { id: taskId } });
    const storageBefore = await database().storageObject.findUniqueOrThrow({ where: { id: storageObjectId } });

    const pagedFixtureIds: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const document = await canvasStore().createCreatorCanvasDocument({
        userId: ownerA,
        title: `Paged Canvas ${index}`,
        state: { ...initialState, document: `paged-${index}` }
      });
      pagedFixtureIds.push(document.id);
      await database().creatorCanvasDocument.update({
        where: { id: document.id },
        data: { updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)) }
      });
    }

    const firstPage = await canvasStore().listCreatorCanvasDocumentsPageForUser(
      ownerA,
      1,
      20
    );
    const secondPage = await canvasStore().listCreatorCanvasDocumentsPageForUser(
      ownerA,
      2,
      20
    );
    const thirdPage = await canvasStore().listCreatorCanvasDocumentsPageForUser(
      ownerA,
      3,
      20
    );
    expect(firstPage.total).toBe(53);
    expect(firstPage.documents).toHaveLength(20);
    expect(secondPage.documents).toHaveLength(20);
    expect(thirdPage.documents).toHaveLength(13);
    expect(firstPage.documents[0]?.id).toBe(newer.id);
    expect(firstPage.documents[1]?.id).toBe(older.id);
    expect(firstPage.documents[2]?.id).toBe(pagedFixtureIds[50]);
    expect(firstPage.documents[0]).not.toHaveProperty("state");
    expect(new Set([
      ...firstPage.documents,
      ...secondPage.documents,
      ...thirdPage.documents
    ]).size).toBe(53);
    const ownerBPage = await canvasStore().listCreatorCanvasDocumentsPageForUser(
      ownerB,
      1,
      20
    );
    expect(ownerBPage).toEqual({ documents: [], total: 0 });

    expect(await canvasStore().deleteCreatorCanvasDocumentForUser(ownerA, newer.id))
      .toBe(true);
    expect(await canvasStore().findCreatorCanvasDocumentForUser(ownerA, newer.id))
      .toBeNull();
    expect(await database().aiAsset.findUniqueOrThrow({ where: { id: assetId } }))
      .toEqual(assetBefore);
    expect(await database().aiTask.findUniqueOrThrow({ where: { id: taskId } }))
      .toEqual(taskBefore);
    expect(await database().storageObject.findUniqueOrThrow({ where: { id: storageObjectId } }))
      .toEqual(storageBefore);
  });
});

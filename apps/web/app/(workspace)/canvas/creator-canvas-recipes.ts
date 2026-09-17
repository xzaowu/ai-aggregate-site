import type {
  CreatorCanvasDocumentV1,
  CreatorContentNode
} from "./creator-canvas-document";
import { parseCreatorCanvasDocument } from "./creator-canvas-document";
import type { CreatorImageComposerDraft } from "./creator-image-composer";
import {
  createCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";

export const PRODUCT_AD_SHORT_VIDEO_RECIPE_ID = "product-ad-short-video" as const;

export const PRODUCT_AD_SHORT_VIDEO_RECIPE = Object.freeze({
  id: PRODUCT_AD_SHORT_VIDEO_RECIPE_ID,
  titleKey: "creator.canvas.recipe.productAdShortVideo.title",
  descriptionKey: "creator.canvas.recipe.productAdShortVideo.description",
  eyebrowKey: "creator.canvas.recipeStarter.eyebrow",
  flowLabelKey: "creator.canvas.recipeStarter.flowLabel",
  flowStepKeys: [
    "creator.canvas.recipeStarter.flow.brief",
    "creator.canvas.recipeStarter.flow.creative",
    "creator.canvas.recipeStarter.flow.keyframe",
    "creator.canvas.recipeStarter.flow.image",
    "creator.canvas.recipeStarter.flow.motion",
    "creator.canvas.recipeStarter.flow.video"
  ] as const,
  useWorkflowKey: "creator.canvas.recipeStarter.useWorkflow",
  blankStartKey: "creator.canvas.recipeStarter.blankStart",
  creativeInstructionKey: "creator.canvas.recipe.productAdShortVideo.creativeInstruction",
  keyframeInstructionKey: "creator.canvas.recipe.productAdShortVideo.keyframeInstruction",
  motionInstructionKey: "creator.canvas.recipe.productAdShortVideo.motionInstruction"
} as const);

export const CREATOR_CANVAS_RECIPE_DEFINITIONS = Object.freeze([
  PRODUCT_AD_SHORT_VIDEO_RECIPE
] as const);

export type CreatorCanvasRecipeDefinition =
  (typeof CREATOR_CANVAS_RECIPE_DEFINITIONS)[number];

export interface CreatorCanvasRecipeInstructions {
  creative: string;
  keyframe: string;
  motion: string;
}

export type CreatorCanvasRecipeIdFactory = (prefix: string) => string;

export interface CreatorCanvasRecipeFactoryOptions {
  instructions: CreatorCanvasRecipeInstructions;
  createId?: CreatorCanvasRecipeIdFactory;
}

export interface CreatorCanvasRecipeSnapshot {
  document: CreatorCanvasDocumentV1;
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>;
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft>;
}

let fallbackRecipeIdSequence = 0;

function createDefaultRecipeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  fallbackRecipeIdSequence += 1;
  return `${prefix}-${Date.now()}-${fallbackRecipeIdSequence}`;
}

function createFreshRecipeId(
  prefix: string,
  createId: CreatorCanvasRecipeIdFactory,
  usedIds: Set<string>
): string {
  const id = createId(prefix).trim();
  if (!id || usedIds.has(id)) {
    throw new Error("CREATOR_CANVAS_RECIPE_ID_INVALID");
  }
  usedIds.add(id);
  return id;
}

function createProductAdShortVideoDocument(
  instructions: CreatorCanvasRecipeInstructions,
  createId: CreatorCanvasRecipeIdFactory
): {
  document: CreatorCanvasDocumentV1;
  videoNodeId: string;
} {
  const usedIds = new Set<string>();
  const briefNodeId = createFreshRecipeId("brief", createId, usedIds);
  const creativeNodeId = createFreshRecipeId("creative", createId, usedIds);
  const keyframeNodeId = createFreshRecipeId("keyframe", createId, usedIds);
  const imageNodeId = createFreshRecipeId("image", createId, usedIds);
  const motionNodeId = createFreshRecipeId("motion", createId, usedIds);
  const videoNodeId = createFreshRecipeId("video", createId, usedIds);

  const nodes: CreatorContentNode[] = [
    {
      id: briefNodeId,
      kind: "text",
      position: { x: 0, y: 0 },
      data: { text: "" }
    },
    {
      id: creativeNodeId,
      kind: "text",
      position: { x: 380, y: 0 },
      data: {
        text: "",
        ai: { instruction: instructions.creative, modelId: "" }
      }
    },
    {
      id: keyframeNodeId,
      kind: "text",
      position: { x: 760, y: -160 },
      data: {
        text: "",
        ai: { instruction: instructions.keyframe, modelId: "" }
      }
    },
    {
      id: imageNodeId,
      kind: "image",
      position: { x: 1140, y: -160 },
      data: { assetId: null }
    },
    {
      id: motionNodeId,
      kind: "text",
      position: { x: 760, y: 220 },
      data: {
        text: "",
        ai: { instruction: instructions.motion, modelId: "" }
      }
    },
    {
      id: videoNodeId,
      kind: "video",
      position: { x: 1140, y: 220 },
      data: { assetId: null }
    }
  ];

  const edge = (
    prefix: string,
    sourceNodeId: string,
    targetNodeId: string
  ) => ({
    id: createFreshRecipeId(prefix, createId, usedIds),
    sourceNodeId,
    targetNodeId,
    relationship: "reference" as const
  });

  const parsed = parseCreatorCanvasDocument({
    version: 1,
    nodes,
    edges: [
      edge("brief-to-creative", briefNodeId, creativeNodeId),
      edge("creative-to-keyframe", creativeNodeId, keyframeNodeId),
      edge("keyframe-to-image", keyframeNodeId, imageNodeId),
      edge("creative-to-motion", creativeNodeId, motionNodeId),
      edge("motion-to-video", motionNodeId, videoNodeId),
      edge("image-to-video", imageNodeId, videoNodeId)
    ],
    viewport: { x: 60, y: 90, zoom: 0.55 }
  });
  if (!parsed.ok) {
    throw new Error("CREATOR_CANVAS_RECIPE_DOCUMENT_INVALID");
  }
  return { document: parsed.document, videoNodeId };
}

export function createProductAdShortVideoRecipeSnapshot({
  instructions,
  createId = createDefaultRecipeId
}: CreatorCanvasRecipeFactoryOptions): CreatorCanvasRecipeSnapshot {
  const { document, videoNodeId } = createProductAdShortVideoDocument(
    instructions,
    createId
  );
  const videoDraft = createCreatorVideoComposerDraft("");
  videoDraft.mode = "image-to-video";

  return {
    document,
    imageComposerDrafts: new Map(),
    videoComposerDrafts: new Map([[videoNodeId, videoDraft]])
  };
}

export function createCreatorCanvasRecipeSnapshot(
  recipeId: typeof PRODUCT_AD_SHORT_VIDEO_RECIPE_ID,
  options: CreatorCanvasRecipeFactoryOptions
): CreatorCanvasRecipeSnapshot {
  if (recipeId !== PRODUCT_AD_SHORT_VIDEO_RECIPE_ID) {
    throw new Error("CREATOR_CANVAS_RECIPE_NOT_FOUND");
  }
  return createProductAdShortVideoRecipeSnapshot(options);
}

export type Mode = "practice" | "mothership" | "recall";
export type NodeShape = "ellipse" | "rect" | "star";
export type NodeKind = "text" | "image" | "drawing";
export type RelationType =
  | "purpose"
  | "definition"
  | "analogy"
  | "causality"
  | "contrast"
  | "trigger";
export type Grade = "correct" | "partial" | "wrong";

export type StrokePoint = { x: number; y: number; pressure: number };
export type Stroke = { id: string; color: string; width: number; points: StrokePoint[] };

export interface Topic {
  id: string;
  title: string;
  color: string;
  lastActiveParentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeNode {
  id: string;
  topicId: string;
  parentId?: string;
  text: string;
  kind: NodeKind;
  imageBlob?: Blob;
  imageMime?: string;
  strokes: Stroke[];
  shape: NodeShape;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  isStagedInMothership: boolean;
  redFlag: boolean;
  reviewBox: number;
  nextReviewAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Connection {
  id: string;
  topicId: string;
  sourceId: string;
  targetId: string;
  relation: RelationType;
  condition?: string;
  isCrossLink: boolean;
  active: boolean;
}

export interface RecallAttempt {
  id: string;
  topicId: string;
  nodeId: string;
  answer: string;
  similarity?: number;
  grade: Grade;
  createdAt: number;
}

export interface Preference {
  id: "app";
  mode: Mode;
  topicId?: string;
  hudVisible: boolean;
  weaknessOnly: boolean;
  trayOpen: boolean;
  viewport: { x: number; y: number; scale: number };
}

export const RELATIONS: Record<RelationType, { icon: string; label: string }> = {
  purpose: { icon: "🎯", label: "目的" },
  definition: { icon: "📖", label: "定義" },
  analogy: { icon: "💡", label: "類推" },
  causality: { icon: "🔄", label: "因果" },
  contrast: { icon: "⚡", label: "対比・落とし穴" },
  trigger: { icon: "🚀", label: "トリガー" },
};


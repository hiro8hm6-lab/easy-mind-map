import Dexie, { type EntityTable } from "dexie";
import type { Connection, KnowledgeNode, Preference, RecallAttempt, Topic } from "./types";

class SynapseQuestDB extends Dexie {
  topics!: EntityTable<Topic, "id">;
  nodes!: EntityTable<KnowledgeNode, "id">;
  connections!: EntityTable<Connection, "id">;
  attempts!: EntityTable<RecallAttempt, "id">;
  preferences!: EntityTable<Preference, "id">;

  constructor() {
    super("synapsequest-v5");
    this.version(1).stores({
      topics: "id, updatedAt",
      nodes: "id, topicId, parentId, isStagedInMothership, nextReviewAt, updatedAt",
      connections: "id, topicId, sourceId, targetId, relation, isCrossLink",
      attempts: "id, topicId, nodeId, createdAt",
      preferences: "id",
    });
  }
}

export const db = new SynapseQuestDB();

export async function seedDemo() {
  if ((await db.topics.count()) > 0) return;
  const now = Date.now();
  const topicId = "cardiology-demo";
  const nodes: KnowledgeNode[] = [
    { id: "heart", topicId, text: "急性冠症候群", kind: "text", strokes: [], shape: "ellipse", x: 120, y: 360, width: 184, height: 92, depth: 0, isStagedInMothership: true, redFlag: false, reviewBox: 2, nextReviewAt: now - 86400000, createdAt: now, updatedAt: now },
    { id: "ischemia", topicId, parentId: "heart", text: "冠血流低下による心筋虚血", kind: "text", strokes: [], shape: "rect", x: 430, y: 178, width: 210, height: 96, depth: 1, isStagedInMothership: true, redFlag: false, reviewBox: 1, nextReviewAt: now, createdAt: now, updatedAt: now },
    { id: "pain", topicId, parentId: "heart", text: "胸骨後部の圧迫痛", kind: "text", strokes: [], shape: "ellipse", x: 430, y: 360, width: 194, height: 86, depth: 1, isStagedInMothership: true, redFlag: false, reviewBox: 3, nextReviewAt: now + 86400000, createdAt: now, updatedAt: now },
    { id: "stemi", topicId, parentId: "heart", text: "ST上昇型心筋梗塞", kind: "text", strokes: [], shape: "star", x: 430, y: 550, width: 194, height: 98, depth: 1, isStagedInMothership: true, redFlag: true, reviewBox: 0, nextReviewAt: now - 3600000, createdAt: now, updatedAt: now },
    { id: "plaque", topicId, parentId: "ischemia", text: "プラーク破綻と血栓形成", kind: "drawing", strokes: [{ id: "demo-stroke", color: "#8df7ff", width: 3, points: [{x:12,y:48,pressure:.4},{x:42,y:28,pressure:.7},{x:80,y:54,pressure:.9},{x:120,y:22,pressure:.6},{x:168,y:44,pressure:.5}] }], shape: "rect", x: 760, y: 102, width: 210, height: 112, depth: 2, isStagedInMothership: true, redFlag: false, reviewBox: 1, nextReviewAt: now, createdAt: now, updatedAt: now },
    { id: "troponin", topicId, parentId: "ischemia", text: "トロポニン上昇", kind: "text", strokes: [], shape: "ellipse", x: 760, y: 250, width: 180, height: 80, depth: 2, isStagedInMothership: true, redFlag: false, reviewBox: 2, nextReviewAt: now + 86400000, createdAt: now, updatedAt: now },
    { id: "radiation", topicId, parentId: "pain", text: "左肩・顎への放散痛", kind: "text", strokes: [], shape: "rect", x: 760, y: 385, width: 190, height: 82, depth: 2, isStagedInMothership: true, redFlag: false, reviewBox: 2, nextReviewAt: now, createdAt: now, updatedAt: now },
    { id: "pci", topicId, parentId: "stemi", text: "緊急PCIを優先", kind: "text", strokes: [], shape: "star", x: 760, y: 536, width: 184, height: 92, depth: 2, isStagedInMothership: true, redFlag: true, reviewBox: 0, nextReviewAt: now - 7200000, createdAt: now, updatedAt: now },
    { id: "door", topicId, parentId: "pci", text: "Door-to-balloon 90分以内", kind: "text", strokes: [], shape: "rect", x: 1060, y: 536, width: 216, height: 86, depth: 3, isStagedInMothership: true, redFlag: true, reviewBox: 0, nextReviewAt: now, createdAt: now, updatedAt: now },
    { id: "staged", topicId, text: "右室梗塞では硝酸薬に注意", kind: "text", strokes: [], shape: "rect", x: 280, y: 690, width: 220, height: 88, depth: 0, isStagedInMothership: false, redFlag: true, reviewBox: 0, nextReviewAt: now, createdAt: now, updatedAt: now },
  ];
  const links: Connection[] = [
    ["e1","heart","ischemia","definition",false], ["e2","heart","pain","purpose",false],
    ["e3","heart","stemi","contrast",false], ["e4","ischemia","plaque","causality",false],
    ["e5","ischemia","troponin","analogy",false], ["e6","pain","radiation","definition",false],
    ["e7","stemi","pci","trigger",false,"[1st Line]"], ["e8","pci","door","trigger",false,"[+]"],
    ["e9","pain","stemi","contrast",true,"[Contraindicated]"],
  ].map(([id,sourceId,targetId,relation,isCrossLink,condition]) => ({ id, topicId, sourceId, targetId, relation, isCrossLink, condition, active: true } as Connection));
  await db.transaction("rw", db.topics, db.nodes, db.connections, db.preferences, async () => {
    await db.topics.add({ id: topicId, title: "Cardiology — 急性冠症候群", color: "#43f7ff", lastActiveParentId: "heart", createdAt: now, updatedAt: now });
    await db.nodes.bulkAdd(nodes);
    await db.connections.bulkAdd(links);
    await db.preferences.add({ id: "app", mode: "mothership", topicId, hudVisible: true, weaknessOnly: false, trayOpen: true, viewport: { x: 0, y: 0, scale: 1 } });
  });
}


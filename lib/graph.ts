import type { Connection, Grade, KnowledgeNode, RecallAttempt } from "./types";

export function structuralConnections(connections: Connection[]) {
  return connections.filter((edge) => !edge.isCrossLink && edge.active);
}

export function descendants(rootId: string, connections: Connection[], maxDepth = 3, enabledRoots?: Set<string>) {
  const edges = structuralConnections(connections);
  const found = new Set<string>();
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const edge of edges.filter((candidate) => candidate.sourceId === source)) {
        if (depth === 0 && enabledRoots && !enabledRoots.has(edge.targetId)) continue;
        if (!found.has(edge.targetId)) { found.add(edge.targetId); next.push(edge.targetId); }
      }
    }
    frontier = next;
  }
  return found;
}

export function wouldCreateCycle(nodeId: string, parentId: string, connections: Connection[]) {
  return nodeId === parentId || descendants(nodeId, connections, Number.MAX_SAFE_INTEGER).has(parentId);
}

export function lineWidthForDepth(depth: number) {
  if (depth <= 0) return 11;
  if (depth === 1) return 6;
  return 2.5;
}

export function normalizeAnswer(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\p{P}\p{S}]/gu, "");
}

export function similarity(answer: string, expected: string) {
  const a = normalizeAnswer(answer);
  const b = normalizeAnswer(expected);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return Math.max(0, 1 - row[b.length] / Math.max(a.length, b.length));
}

export function gradeForSimilarity(value: number): Grade {
  return value >= .85 ? "correct" : value >= .65 ? "partial" : "wrong";
}

export function nodeStats(nodeId: string, attempts: RecallAttempt[]) {
  const rows = attempts.filter((attempt) => attempt.nodeId === nodeId);
  const correct = rows.filter((attempt) => attempt.grade === "correct").length;
  const rate = rows.length ? Math.round((correct / rows.length) * 100) : 0;
  const status: Grade = rows.length === 0 ? "partial" : rate >= 85 ? "correct" : rate >= 65 ? "partial" : "wrong";
  return { count: rows.length, rate, status };
}

export function nextReview(grade: Grade, currentBox: number, now = Date.now()) {
  const day = 86400000;
  if (grade === "wrong") return { reviewBox: 0, nextReviewAt: now };
  if (grade === "partial") return { reviewBox: currentBox, nextReviewAt: now + day };
  const reviewBox = Math.min(3, currentBox + 1);
  return { reviewBox, nextReviewAt: now + [1, 3, 7, 14][reviewBox] * day };
}

export function recallPriority(node: KnowledgeNode, attempts: RecallAttempt[]) {
  const stats = nodeStats(node.id, attempts);
  return (node.nextReviewAt <= Date.now() ? 1_000_000 : 0) + (node.redFlag ? 100_000 : 0) + (100 - stats.rate) * 100 - node.updatedAt / 1e12;
}


import JSZip from "jszip";
import type { Connection, KnowledgeNode, Topic } from "./types";

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export async function exportAnki(topic: Topic, nodes: KnowledgeNode[], connections: Connection[]) {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const edges = connections.filter((edge) => edge.active && edge.relation === "contrast");
  const media: { name: string; blob: Blob }[] = [];
  const rows = [["Front", "Back"]];
  for (const edge of edges) {
    const parent = map.get(edge.sourceId); const child = map.get(edge.targetId);
    if (!parent || !child) continue;
    const front = `${topic.title} > ${parent.text}<br>⚡ ${edge.condition ?? ""}`;
    let back = child.text;
    if (child.imageBlob) {
      const extension = child.imageMime?.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const name = `synapsequest-${child.id}.${extension}`;
      media.push({ name, blob: child.imageBlob });
      back = `${back}<br><img src="${name}">`;
    }
    rows.push([front, back]);
  }
  const csv = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  if (!media.length) return { blob: new Blob([csv], { type: "text/csv;charset=utf-8" }), filename: `${topic.title}-anki.csv` };
  const zip = new JSZip(); zip.file("synapsequest-anki.csv", csv);
  media.forEach((entry) => zip.file(entry.name, entry.blob));
  return { blob: await zip.generateAsync({ type: "blob" }), filename: `${topic.title}-anki.zip` };
}


"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { forceCollide, forceLink, forceSimulation, forceX, forceY } from "d3-force";
import { Activity, BrainCircuit, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FolderOpen, ImagePlus, Layers3, Menu, PenLine, Plus, Sparkles, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { db, seedDemo } from "@/lib/db";
import { descendants, gradeForSimilarity, lineWidthForDepth, nextReview, nodeStats, recallPriority, similarity, wouldCreateCycle } from "@/lib/graph";
import { exportAnki } from "@/lib/anki";
import type { Connection, Grade, KnowledgeNode, Mode, NodeShape, RelationType, Stroke } from "@/lib/types";
import { RELATIONS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CANVAS_W = 1440, CANVAS_H = 850;
const STAR_MIN_WIDTH = 220, STAR_MIN_HEIGHT = 132;
const MODE_META: Record<Mode, { key: string; label: string; hint: string }> = {
  practice: { key: "1", label: "Practice", hint: "高速キャプチャ" },
  mothership: { key: "2", label: "Mothership", hint: "知識を整理" },
  recall: { key: "3", label: "Recall", hint: "思い出す" },
};
const SHAPES: { value: NodeShape; label: string; glyph: string }[] = [
  { value: "ellipse", label: "知ってた", glyph: "○" }, { value: "rect", label: "忘れてた", glyph: "□" }, { value: "star", label: "はじめて", glyph: "☆" },
];
const RELATION_ORDER: RelationType[] = ["purpose", "definition", "analogy", "causality", "contrast", "trigger"];
type Viewport = { x: number; y: number; scale: number };
type Point = { x: number; y: number };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function curve(source: KnowledgeNode, target: KnowledgeNode) {
  const x1 = source.x + source.width, y1 = source.y + source.height / 2, x2 = target.x, y2 = target.y + target.height / 2;
  const bend = Math.max(72, Math.abs(x2 - x1) * .46); return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
function ImageContent({ node, hidden = false }: { node: KnowledgeNode; hidden?: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!node.imageBlob) return; const next = URL.createObjectURL(node.imageBlob); setUrl(next); return () => URL.revokeObjectURL(next); }, [node.imageBlob]);
  return hidden || !url ? null : <img src={url} alt={node.text} className="node-image" draggable={false} />;
}
function StrokeSvg({ strokes, className = "", onPointerDown, onPointerMove, onPointerUp }: { strokes: Stroke[]; className?: string; onPointerDown?: React.PointerEventHandler<SVGSVGElement>; onPointerMove?: React.PointerEventHandler<SVGSVGElement>; onPointerUp?: React.PointerEventHandler<SVGSVGElement> }) {
  return <svg className={className} viewBox="0 0 200 100" preserveAspectRatio="none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>{strokes.map((stroke) => <polyline key={stroke.id} points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}</svg>;
}
function StatusMark({ grade }: { grade: Grade }) { return <span className={`status-mark ${grade}`} aria-label={grade === "correct" ? "定着" : grade === "partial" ? "要復習" : "弱点"}>{grade === "correct" ? "🟦" : grade === "partial" ? "🟨" : "🟥"}</span>; }

export function SynapseQuest() {
  const topics = useLiveQuery(() => db.topics.orderBy("updatedAt").reverse().toArray(), [], []);
  const preference = useLiveQuery(() => db.preferences.get("app"), [], undefined);
  const topicId = preference?.topicId ?? topics[0]?.id;
  const nodes = useLiveQuery(() => topicId ? db.nodes.where("topicId").equals(topicId).toArray() : [], [topicId], []);
  const connections = useLiveQuery(() => topicId ? db.connections.where("topicId").equals(topicId).toArray() : [], [topicId], []);
  const attempts = useLiveQuery(() => topicId ? db.attempts.where("topicId").equals(topicId).toArray() : [], [topicId], []);
  const topic = topics.find((item) => item.id === topicId), mode = preference?.mode ?? "mothership";
  const hudVisible = preference?.hudVisible ?? true, weaknessOnly = preference?.weaknessOnly ?? false, trayOpen = preference?.trayOpen ?? true;
  const [selectedId, setSelectedId] = useState<string>(), [shapePickerId, setShapePickerId] = useState<string>();
  const [quickOpen, setQuickOpen] = useState(false), [topicDialog, setTopicDialog] = useState(false), [topicTitle, setTopicTitle] = useState("");
  const [traySelected, setTraySelected] = useState<Set<string>>(new Set()), [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [recallRoot, setRecallRoot] = useState<string>(), [enabledBranches, setEnabledBranches] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({}), [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [drawAnswers, setDrawAnswers] = useState<Record<string, Stroke[]>>({}), [penNodeId, setPenNodeId] = useState<string>(), [drawingStroke, setDrawingStroke] = useState<Stroke>();
  const [mobileIndex, setMobileIndex] = useState(0), [message, setMessage] = useState("準備完了 — ノードを選択して整理できます"), [isAttaching, setIsAttaching] = useState(false);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | undefined>(undefined), panRef = useRef<{ x: number; y: number; startX: number; startY: number } | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null), nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  useEffect(() => {
    let active = true;
    seedDemo()
      .then(() => { if (active) setMessage("準備完了 — ノードを選択して整理できます"); })
      .catch(() => { if (active) setMessage("デモデータを保存できませんでした"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const undersized = nodes.filter((node) => node.shape === "star" && (node.width < STAR_MIN_WIDTH || node.height < STAR_MIN_HEIGHT));
    if (!undersized.length) return;
    void db.transaction("rw", db.nodes, async () => Promise.all(undersized.map((node) => {
      const width = Math.max(node.width, STAR_MIN_WIDTH), height = Math.max(node.height, STAR_MIN_HEIGHT);
      return db.nodes.update(node.id, { x: node.x - (width - node.width) / 2, y: node.y - (height - node.height) / 2, width, height, updatedAt: Date.now() });
    }))).catch(() => toast.error("星型ノードの表示サイズを更新できませんでした"));
  }, [nodes]);
  useEffect(() => { if (preference?.viewport) setViewport(preference.viewport); }, [preference?.viewport]);
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined); }, []);
  const updatePref = useCallback(async (patch: Partial<NonNullable<typeof preference>>) => {
    const base = preference ?? { id: "app" as const, mode: "mothership" as Mode, topicId, hudVisible: true, weaknessOnly: false, trayOpen: true, viewport };
    try { await db.preferences.put({ ...base, ...patch, id: "app" }); } catch { toast.error("設定を保存できませんでした"); }
  }, [preference, topicId, viewport]);
  const selectTopic = useCallback((id: string) => { setSelectedId(undefined); setRecallRoot(undefined); setQuickOpen(false); setMobileIndex(0); updatePref({ topicId: id }); }, [updatePref]);

  const createNode = useCallback(async (point?: Point, image?: Blob) => {
    if (!topicId) return; const now = Date.now(), id = crypto.randomUUID(), rect = canvasRef.current?.getBoundingClientRect();
    const center = point ?? { x: ((rect?.width ?? 1000) / 2 - viewport.x) / viewport.scale, y: ((rect?.height ?? 700) / 2 - viewport.y) / viewport.scale };
    const node: KnowledgeNode = { id, topicId, text: image ? "画像の要点を入力" : "新しい知識", kind: image ? "image" : "text", imageBlob: image, imageMime: image?.type, strokes: [], shape: "rect", x: Math.max(20, center.x - 90), y: Math.max(20, center.y - 42), width: image ? 220 : 184, height: image ? 150 : 86, depth: 0, isStagedInMothership: false, redFlag: true, reviewBox: 0, nextReviewAt: now, createdAt: now, updatedAt: now };
    try { await db.nodes.add(node); setSelectedId(id); setShapePickerId(id); setMessage(image ? "画像を取り込みました" : "ノードを作成しました"); } catch { toast.error("ノードを保存できませんでした。入力はそのままです。"); }
  }, [topicId, viewport]);
  const beginRecall = useCallback((id: string) => {
    const children = connections.filter((edge) => !edge.isCrossLink && edge.sourceId === id).map((edge) => edge.targetId);
    setRecallRoot(id); setEnabledBranches(new Set(children)); setAnswers({}); setRevealed(new Set()); setDrawAnswers({}); setMobileIndex(0); setMessage(children.length ? `${children.length}本の枝からRecallを開始` : "下流ノードがありません");
  }, [connections]);

  const recalculateDepths = useCallback(async (rootId: string) => {
    const root = await db.nodes.get(rootId); if (!root) return; const edges = await db.connections.where("topicId").equals(root.topicId).toArray();
    const visited = new Set([rootId]);
    let frontier = [rootId], depth = root.depth + 1;
    while (frontier.length) {
      const ids = edges
        .filter((edge) => edge.active && !edge.isCrossLink && frontier.includes(edge.sourceId) && !visited.has(edge.targetId))
        .map((edge) => edge.targetId);
      if (!ids.length) break;
      ids.forEach((id) => visited.add(id));
      await Promise.all(ids.map((id) => db.nodes.update(id, { depth, updatedAt: Date.now() })));
      frontier = ids;
      depth++;
    }
  }, []);
  const reparent = useCallback(async (nodeId: string, parentId: string) => {
    const node = nodeMap.get(nodeId), parent = nodeMap.get(parentId);
    if (!node || !parent || wouldCreateCycle(nodeId, parentId, connections)) { toast.error("子孫ノードには接続できません"); return false; }
    const old = connections.find((edge) => !edge.isCrossLink && edge.targetId === nodeId);
    await db.transaction("rw", db.nodes, db.connections, db.topics, async () => { if (old) await db.connections.delete(old.id); await db.connections.add({ id: crypto.randomUUID(), topicId: node.topicId, sourceId: parentId, targetId: nodeId, relation: "definition", isCrossLink: false, active: true }); await db.nodes.update(nodeId, { parentId, depth: parent.depth + 1, isStagedInMothership: true, updatedAt: Date.now() }); await db.topics.update(node.topicId, { lastActiveParentId: parentId, updatedAt: Date.now() }); });
    await recalculateDepths(nodeId);
    return true;
  }, [connections, nodeMap, recalculateDepths]);

  const autoCleanup = useCallback(async () => {
    const layoutNodes = nodes.filter((node) => node.isStagedInMothership).map((node) => ({ ...node })); if (!layoutNodes.length) return;
    const links = connections.filter((edge) => !edge.isCrossLink).map((edge) => ({ source: edge.sourceId, target: edge.targetId }));
    const simulation = forceSimulation(layoutNodes).force("link", forceLink(links).id((d: any) => d.id).distance(250).strength(.35)).force("collide", forceCollide<any>().radius((d) => Math.max(d.width, d.height) * .62 + 24).strength(1)).force("x", forceX<any>((d) => 120 + d.depth * 310).strength(.9)).force("y", forceY<any>(CANVAS_H / 2).strength(.06)).stop();
    for (let i = 0; i < 240; i++) simulation.tick();
    await db.transaction("rw", db.nodes, async () => Promise.all(layoutNodes.map((node) => db.nodes.update(node.id, { x: Math.max(40, Math.min(CANVAS_W - node.width - 40, node.x ?? 0)), y: Math.max(40, Math.min(CANVAS_H - node.height - 40, node.y ?? 0)), updatedAt: Date.now() })))); toast.success("知識マップを整列しました");
  }, [connections, nodes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (target.matches("input, textarea, [contenteditable=true]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setQuickOpen(true); return; }
      if (event.key === "1") updatePref({ mode: "practice" }); if (event.key === "2") updatePref({ mode: "mothership" }); if (event.key === "3") updatePref({ mode: "recall" });
      if (event.key.toLowerCase() === "h") updatePref({ hudVisible: !hudVisible }); if (event.shiftKey && event.key.toLowerCase() === "w") updatePref({ weaknessOnly: !weaknessOnly });
      if (event.shiftKey && event.key.toLowerCase() === "a") autoCleanup(); if (event.key.toLowerCase() === "n" && mode === "practice") createNode(); if (event.code === "Space" && mode === "recall") { event.preventDefault(); setMobileIndex((value) => value + 1); }
    };
    const onPaste = (event: ClipboardEvent) => { if (mode !== "practice") return; const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/")); if (file) { event.preventDefault(); createNode(undefined, file); } };
    window.addEventListener("keydown", onKey); window.addEventListener("paste", onPaste); return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", onPaste); };
  }, [autoCleanup, createNode, hudVisible, mode, updatePref, weaknessOnly]);

  useEffect(() => {
    type MCP = { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: MCP }).modelContext; if (!context?.registerTool) return; const controller = new AbortController();
    Promise.resolve(context.registerTool({ name: "create_nodes", title: "知識ノードを作成", description: "現在のTopicにテキスト知識ノードを作成します。", inputSchema: { type: "object", properties: { texts: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["texts"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { const texts = (input as { texts?: string[] }).texts; if (!Array.isArray(texts)) throw new Error("texts is required"); const now = Date.now(); await db.nodes.bulkAdd(texts.map((text, index) => ({ id: crypto.randomUUID(), topicId: topicId!, text, kind: "text" as const, strokes: [], shape: "rect" as const, x: 260, y: 120 + index * 110, width: 184, height: 86, depth: 0, isStagedInMothership: false, redFlag: true, reviewBox: 0, nextReviewAt: now, createdAt: now + index, updatedAt: now }))); return { created: texts.length }; } }, { signal: controller.signal })).catch(() => undefined);
    Promise.resolve(context.registerTool({ name: "start_recall", title: "Recallを開始", description: "指定ノードから3階層のRecallを開始します。", inputSchema: { type: "object", properties: { nodeId: { type: "string" } }, required: ["nodeId"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { const nodeId = (input as { nodeId?: string }).nodeId; if (!nodeId || !nodeMap.has(nodeId)) throw new Error("Unknown node"); await updatePref({ mode: "recall" }); beginRecall(nodeId); return { nodeId, masked: descendants(nodeId, connections, 3).size }; } }, { signal: controller.signal })).catch(() => undefined);
    return () => controller.abort();
  }, [beginRecall, connections, nodeMap, topicId, updatePref]);

  const maskedIds = useMemo(() => recallRoot ? descendants(recallRoot, connections, 3, enabledBranches) : new Set<string>(), [recallRoot, connections, enabledBranches]);
  const recallQueue = useMemo(() => Array.from(maskedIds).map((id) => nodeMap.get(id)).filter((node): node is KnowledgeNode => !!node).filter((node) => !weaknessOnly || nodeStats(node.id, attempts).status !== "correct").sort((a, b) => recallPriority(b, attempts) - recallPriority(a, attempts)), [maskedIds, nodeMap, weaknessOnly, attempts]);
  const saveText = async (id: string, text: string) => { try { await db.nodes.update(id, { text, updatedAt: Date.now() }); } catch { toast.error("変更を保存できませんでした"); } };
  const setShape = async (id: string, shape: NodeShape) => {
    const node = nodeMap.get(id); if (!node) return;
    const width = shape === "star" ? Math.max(node.width, STAR_MIN_WIDTH) : node.width;
    const height = shape === "star" ? Math.max(node.height, STAR_MIN_HEIGHT) : node.height;
    await db.nodes.update(id, { shape, x: node.x - (width - node.width) / 2, y: node.y - (height - node.height) / 2, width, height, updatedAt: Date.now() });
    setShapePickerId(undefined);
  };
  const attachTray = async (parentId?: string, ids = traySelected) => {
    const target = parentId ?? topic?.lastActiveParentId;
    if (!target || !ids.size || isAttaching) { if (!isAttaching) toast.info("Trayのノードを選択してください"); return; }
    const selectedIds = Array.from(ids);
    setIsAttaching(true);
    setMessage(`${selectedIds.length}件を接続中…`);
    try {
      let attached = 0;
      for (const id of selectedIds) if (await reparent(id, target)) attached++;
      setTraySelected(new Set());
      setMessage(`${attached}件を接続しました`);
      toast.success(`${attached}件を接続しました`);
    } catch {
      setMessage("接続に失敗しました — もう一度お試しください");
      toast.error("ノードを接続できませんでした");
    } finally {
      setIsAttaching(false);
    }
  };
  const gradeNode = async (node: KnowledgeNode, manual?: Grade) => { const score = manual ? undefined : similarity(answers[node.id] ?? "", node.text), grade = manual ?? gradeForSimilarity(score ?? 0), schedule = nextReview(grade, node.reviewBox); await db.transaction("rw", db.nodes, db.attempts, async () => { await db.attempts.add({ id: crypto.randomUUID(), topicId: node.topicId, nodeId: node.id, answer: answers[node.id] ?? "[drawing]", similarity: score, grade, createdAt: Date.now() }); await db.nodes.update(node.id, { ...schedule, redFlag: grade !== "correct", updatedAt: Date.now() }); }); setRevealed((current) => new Set(current).add(node.id)); setMessage(grade === "correct" ? "定着しました — 次の想起へ" : grade === "partial" ? "惜しい。明日もう一度" : "弱点として優先キューへ追加しました"); };

  const pointerToStroke = (event: React.PointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: ((event.clientX - rect.left) / rect.width) * 200, y: ((event.clientY - rect.top) / rect.height) * 100, pressure: event.pressure || .5 }; };
  const startStroke = (event: React.PointerEvent<SVGSVGElement>, nodeId: string, recall: boolean) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrawingStroke({ id: crypto.randomUUID(), color: recall ? "#ffcf5c" : "#74f7ff", width: 2 + (event.pressure || .5) * 3, points: [pointerToStroke(event)] }); setPenNodeId(nodeId); };
  const moveStroke = (event: React.PointerEvent<SVGSVGElement>) => { if (drawingStroke && penNodeId) setDrawingStroke({ ...drawingStroke, points: [...drawingStroke.points, pointerToStroke(event)] }); };
  const endStroke = async (node: KnowledgeNode, recall: boolean) => { if (!drawingStroke) return; if (recall) setDrawAnswers((current) => ({ ...current, [node.id]: [...(current[node.id] ?? []), drawingStroke] })); else await db.nodes.update(node.id, { strokes: [...node.strokes, drawingStroke], kind: node.kind === "image" ? "image" : "drawing", updatedAt: Date.now() }); setDrawingStroke(undefined); };

  const onNodePointerDown = (event: React.PointerEvent, node: KnowledgeNode) => { if (mode === "recall" || penNodeId === node.id) return; event.stopPropagation(); dragRef.current = { id: node.id, offsetX: event.clientX / viewport.scale - node.x, offsetY: event.clientY / viewport.scale - node.y }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); setSelectedId(node.id); };
  const onNodePointerMove = (event: React.PointerEvent, node: KnowledgeNode) => { if (dragRef.current?.id === node.id) db.nodes.update(node.id, { x: event.clientX / viewport.scale - dragRef.current.offsetX, y: event.clientY / viewport.scale - dragRef.current.offsetY, updatedAt: Date.now() }); };
  const onNodePointerUp = async (_event: React.PointerEvent, node: KnowledgeNode) => { if (dragRef.current?.id !== node.id) return; dragRef.current = undefined; if (mode === "mothership") { const nearest = nodes.filter((candidate) => candidate.id !== node.id && candidate.isStagedInMothership).map((candidate) => ({ node: candidate, distance: Math.hypot(candidate.x - node.x, candidate.y - node.y) })).sort((a, b) => a.distance - b.distance)[0]; if (nearest?.distance < 120) await reparent(node.id, nearest.node.id); } };
  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => { if (event.button !== 0) return; panRef.current = { x: viewport.x, y: viewport.y, startX: event.clientX, startY: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); setSelectedId(undefined); };
  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => { if (panRef.current) setViewport((current) => ({ ...current, x: panRef.current!.x + event.clientX - panRef.current!.startX, y: panRef.current!.y + event.clientY - panRef.current!.startY })); };
  const onCanvasPointerUp = () => { if (panRef.current) updatePref({ viewport }); panRef.current = undefined; };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setViewport((current) => ({ ...current, scale: Math.max(.45, Math.min(1.7, current.scale * (event.deltaY > 0 ? .92 : 1.08))) }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);
  const handleExport = async () => { if (!topic) return; const result = await exportAnki(topic, nodes, connections); downloadBlob(result.blob, result.filename); toast.success("Anki用データを書き出しました"); };
  const createTopic = async () => { const title = topicTitle.trim(); if (!title) return; const now = Date.now(), id = crypto.randomUUID(); await db.topics.add({ id, title, color: "#b875ff", createdAt: now, updatedAt: now }); await updatePref({ topicId: id }); setTopicTitle(""); setTopicDialog(false); toast.success("Topicを作成しました"); };
  const sortedTray = nodes.filter((node) => !node.isStagedInMothership), mobileCard = recallQueue.length ? recallQueue[mobileIndex % recallQueue.length] : undefined;

  return <main className="synapse-app">
    <header className="topbar"><div className="brand"><span className="brand-mark"><BrainCircuit /></span><div><b>SynapseQuest</b><small>BIONIC RECALL ENGINE · v5.0</small></div></div>
      <nav className="mode-switcher" aria-label="学習モード">{(Object.keys(MODE_META) as Mode[]).map((value) => <button key={value} className={mode === value ? "active" : ""} onClick={() => updatePref({ mode: value })}><kbd>{MODE_META[value].key}</kbd><span>{MODE_META[value].label}</span><small>{MODE_META[value].hint}</small></button>)}</nav>
      <div className="top-actions"><button className="topic-select" onClick={() => setQuickOpen(true)}><FolderOpen /><span>{topic?.title ?? "Topicを選択"}</span><kbd>⌘K</kbd></button><label className="top-toggle"><span>{hudVisible ? <Eye /> : <EyeOff />} HUD</span><Switch checked={hudVisible} onCheckedChange={(checked) => updatePref({ hudVisible: checked })} aria-label="統計HUD" /></label><button className={`weak-button ${weaknessOnly ? "active" : ""}`} onClick={() => updatePref({ weaknessOnly: !weaknessOnly })}><Activity />弱点 <kbd>⇧W</kbd></button><Button className="export-button" onClick={handleExport}><Download />Anki</Button></div>
    </header>
    <section className="context-strip"><div><span className="live-dot" />{MODE_META[mode].label.toUpperCase()} MODE</div><p>{message}</p><div className="legend">{RELATION_ORDER.map((relation) => <span key={relation}>{RELATIONS[relation].icon} {RELATIONS[relation].label}</span>)}</div></section>
    {mode === "mothership" && <aside className={`tray ${trayOpen ? "open" : ""}`}><button className="tray-tab" onClick={() => updatePref({ trayOpen: !trayOpen })}>{trayOpen ? <ChevronLeft /> : <ChevronRight />}</button><div className="tray-head"><div><span>UNSORTED SIGNALS</span><h2>未整理トレイ <em>{sortedTray.length}</em></h2></div><Button size="icon-sm" variant="ghost" onClick={() => updatePref({ trayOpen: false })}><X /></Button></div><p className="tray-help">選択して最後の親へ接続、またはカードを線へドラッグ</p><div className="tray-list">{sortedTray.map((node) => <button key={node.id} draggable onDragStart={() => setTraySelected(new Set([node.id]))} onClick={() => setTraySelected((current) => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; })} className={`tray-card ${traySelected.has(node.id) ? "selected" : ""}`}><span>{node.kind === "image" ? "IMG" : node.shape === "star" ? "NEW" : "NOTE"}</span><b>{node.text}</b><small>{new Date(node.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</small></button>)}</div><Button disabled={!traySelected.size} onClick={() => attachTray()} className="attach-button"><Layers3 />最後の親へ接続 ({traySelected.size})</Button></aside>}
    <div ref={canvasRef} className={`canvas-shell ${mode} ${weaknessOnly ? "weakness-on" : ""} ${mode === "mothership" && trayOpen ? "tray-space" : ""}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp} onDoubleClick={(event) => { if (mode !== "practice") return; const rect = event.currentTarget.getBoundingClientRect(); createNode({ x: (event.clientX - rect.left - viewport.x) / viewport.scale, y: (event.clientY - rect.top - viewport.y) / viewport.scale }); }}><div className="canvas-grid" /><div className="canvas-world" style={{ width: CANVAS_W, height: CANVAS_H, transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})` }}>
      <svg className="connections" width={CANVAS_W} height={CANVAS_H}><defs><filter id="line-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="branch-gradient"><stop stopColor="#1af1d2"/><stop offset=".56" stopColor="#4da3ff"/><stop offset="1" stopColor="#b468ff"/></linearGradient></defs>{connections.map((edge) => { const source = nodeMap.get(edge.sourceId), target = nodeMap.get(edge.targetId); if (!source || !target || !source.isStagedInMothership || !target.isStagedInMothership) return null; const stats = nodeStats(target.id, attempts); return <path key={edge.id} d={curve(source, target)} className={`branch-line ${edge.isCrossLink ? "cross-link" : ""} ${weaknessOnly && stats.status !== "correct" ? "weak-branch" : ""}`} strokeWidth={edge.isCrossLink ? 2.5 : lineWidthForDepth(source.depth)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); attachTray(source.id); }} />; })}</svg>
      {connections.map((edge) => { const source = nodeMap.get(edge.sourceId), target = nodeMap.get(edge.targetId); if (!source || !target || !source.isStagedInMothership || !target.isStagedInMothership) return null; return <button key={`${edge.id}-badge`} className={`relation-badge ${edge.isCrossLink ? "cross" : ""}`} style={{ left: (source.x + source.width + target.x) / 2, top: (source.y + source.height / 2 + target.y + target.height / 2) / 2 }} title={RELATIONS[edge.relation].label} onClick={() => { if (mode === "recall" && source.id === recallRoot) setEnabledBranches((current) => { const next = new Set(current); next.has(target.id) ? next.delete(target.id) : next.add(target.id); return next; }); }}>{RELATIONS[edge.relation].icon}{edge.condition && <small>{edge.condition}</small>}</button>; })}
      {nodes.filter((node) => node.isStagedInMothership).map((node) => { const stats = nodeStats(node.id, attempts), isMasked = mode === "recall" && maskedIds.has(node.id) && !revealed.has(node.id), selected = selectedId === node.id, drawStrokes = drawAnswers[node.id] ?? []; return <article key={node.id} className={`knowledge-node shape-${node.shape} ${selected ? "selected" : ""} ${mode === "recall" && recallRoot === node.id ? "recall-root" : ""} ${weaknessOnly && stats.status === "correct" ? "mastered-dim" : ""}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onPointerDown={(event) => onNodePointerDown(event, node)} onPointerMove={(event) => onNodePointerMove(event, node)} onPointerUp={(event) => onNodePointerUp(event, node)} onClick={(event) => { event.stopPropagation(); setSelectedId(node.id); if (mode === "recall" && !recallRoot) beginRecall(node.id); }}><div className="node-kicker"><span>L{node.depth + 1}</span><span>{node.redFlag ? "PRIORITY" : node.kind.toUpperCase()}</span></div>
        {isMasked ? <div className="recall-input" onPointerDown={(event) => event.stopPropagation()}>{node.kind === "drawing" ? <><StrokeSvg strokes={[...drawStrokes, ...(drawingStroke && penNodeId === node.id ? [drawingStroke] : [])]} className="draw-surface recall-draw" onPointerDown={(event) => startStroke(event, node.id, true)} onPointerMove={moveStroke} onPointerUp={() => endStroke(node, true)} /><button className="reveal-draw" onClick={() => setRevealed((current) => new Set(current).add(node.id))}>正解を重ねる</button></> : <><input autoFocus={mobileCard?.id === node.id} value={answers[node.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [node.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") gradeNode(node); }} placeholder="思い出して入力…" /><button onClick={() => gradeNode(node)}>採点</button></>}</div> : <><ImageContent node={node} /><textarea value={node.text} onChange={(event) => saveText(node.id, event.target.value)} onPointerDown={(event) => event.stopPropagation()} readOnly={mode === "recall"} /><StrokeSvg strokes={node.strokes} className={`stored-strokes ${penNodeId === node.id ? "drawing" : ""}`} onPointerDown={(event) => penNodeId === node.id && startStroke(event, node.id, false)} onPointerMove={moveStroke} onPointerUp={() => endStroke(node, false)} /></>}
        {mode === "recall" && revealed.has(node.id) && node.kind === "drawing" && <div className="self-grade" onPointerDown={(event) => event.stopPropagation()}><StrokeSvg strokes={node.strokes} className="answer-overlay" />{(["correct","partial","wrong"] as Grade[]).map((grade) => <button key={grade} onClick={() => gradeNode(node, grade)}>{grade === "correct" ? "⭕" : grade === "partial" ? "🔺" : "❌"}</button>)}</div>}{hudVisible && <footer>試行: {stats.count}回 <i /> 正解率: {stats.rate}% <StatusMark grade={stats.status} /></footer>}
        {selected && mode !== "recall" && <div className="node-tools" onPointerDown={(event) => event.stopPropagation()}><button className={penNodeId === node.id ? "active" : ""} onClick={() => setPenNodeId((current) => current === node.id ? undefined : node.id)}><PenLine /></button>{SHAPES.map((shape) => <button key={shape.value} title={shape.label} className={node.shape === shape.value ? "active" : ""} onClick={() => setShape(node.id, shape.value)}>{shape.glyph}</button>)}</div>}{shapePickerId === node.id && <div className="shape-picker" onPointerDown={(event) => event.stopPropagation()}><small>記憶の状態</small>{SHAPES.map((shape) => <button key={shape.value} onClick={() => setShape(node.id, shape.value)}><b>{shape.glyph}</b>{shape.label}</button>)}</div>}</article>; })}
    </div>
      {mode === "practice" && <div className="practice-dock"><Button onClick={() => createNode()}><Plus />ノード</Button><Button variant="outline" onClick={() => setMessage("画像をコピーして Ctrl/Cmd + V で貼り付けてください")}><ImagePlus />画像ペースト</Button><span>ダブルクリック または <kbd>N</kbd></span></div>}
      {mode === "mothership" && <div className="mothership-dock"><Button variant="outline" onClick={() => updatePref({ trayOpen: !trayOpen })}><Menu />Tray</Button><Button onClick={autoCleanup}><WandSparkles />Auto-clean <kbd>⇧A</kbd></Button><Button variant="outline" onClick={() => setTopicDialog(true)}><Plus />Topic</Button></div>}
      {mode === "recall" && !recallRoot && <div className="recall-empty"><Sparkles /><b>Recallの起点を選択</b><span>任意のノードをクリックすると、下流3階層がマスクされます。</span></div>}
    </div>
    {mode === "recall" && recallRoot && <div className="recall-hud"><span>ACTIVE RECALL</span><b>{recallQueue.filter((node) => !revealed.has(node.id)).length}</b><small>未回答 / {recallQueue.length}</small><button onClick={() => { setRecallRoot(undefined); setRevealed(new Set()); }}>終了</button></div>}
    {mode === "recall" && recallRoot && <section className="mobile-deck">{mobileCard ? <div className="mobile-card"><header><span>{mobileIndex % recallQueue.length + 1} / {recallQueue.length}</span><StatusMark grade={nodeStats(mobileCard.id, attempts).status} /></header><small>親の手掛かり</small><h2>{nodeMap.get(mobileCard.parentId ?? "")?.text ?? topic?.title}</h2><div className="mobile-relation">{connections.filter((edge) => edge.targetId === mobileCard.id).map((edge) => <span key={edge.id}>{RELATIONS[edge.relation].icon} {edge.condition}</span>)}</div>{revealed.has(mobileCard.id) ? <div className="mobile-answer"><span>正解</span><b>{mobileCard.text}</b><ImageContent node={mobileCard} /><div>{(["correct","partial","wrong"] as Grade[]).map((grade) => <button key={grade} onClick={() => { gradeNode(mobileCard, grade); setMobileIndex((value) => value + 1); }}>{grade === "correct" ? "⭕" : grade === "partial" ? "🔺" : "❌"}</button>)}</div></div> : mobileCard.kind === "drawing" ? <><StrokeSvg strokes={[...(drawAnswers[mobileCard.id] ?? []), ...(drawingStroke && penNodeId === mobileCard.id ? [drawingStroke] : [])]} className="mobile-draw" onPointerDown={(event) => startStroke(event, mobileCard.id, true)} onPointerMove={moveStroke} onPointerUp={() => endStroke(mobileCard, true)} /><Button onClick={() => setRevealed((current) => new Set(current).add(mobileCard.id))}>正解を重ねる</Button></> : <div className="mobile-input"><input value={answers[mobileCard.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [mobileCard.id]: event.target.value }))} placeholder="答えを入力" /><Button onClick={() => gradeNode(mobileCard)}>採点する</Button></div>}<footer><button onClick={() => setMobileIndex((value) => Math.max(0, value - 1))}><ChevronLeft />前へ</button><button onClick={() => setMobileIndex((value) => value + 1)}>スキップ<ChevronRight /></button></footer></div> : <div className="mobile-card empty"><b>弱点問題はありません</b><span>フィルターを解除してください。</span></div>}</section>}
    <CommandDialog open={quickOpen} onOpenChange={setQuickOpen} title="Topicを切り替え" description="知識マップを検索して開きます" className="neon-dialog"><CommandInput placeholder="Topicを検索…" /><CommandList><CommandEmpty>Topicが見つかりません</CommandEmpty><CommandGroup heading="Knowledge maps">{topics.map((item) => <CommandItem key={item.id} value={item.title} onSelect={() => selectTopic(item.id)}><BrainCircuit style={{ color: item.color }} />{item.title}{item.id === topicId && <CommandShortcut>OPEN</CommandShortcut>}</CommandItem>)}</CommandGroup><CommandGroup><CommandItem onSelect={() => { setQuickOpen(false); setTopicDialog(true); }}><Plus />新しいTopic</CommandItem></CommandGroup></CommandList></CommandDialog>
    <Dialog open={topicDialog} onOpenChange={setTopicDialog}><DialogContent className="neon-dialog"><DialogHeader><DialogTitle>新しいTopic</DialogTitle><DialogDescription>独立した知識マップを作成します。</DialogDescription></DialogHeader><input className="dialog-input" value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createTopic()} placeholder="例: Neurology" autoFocus /><DialogFooter><Button variant="outline" onClick={() => setTopicDialog(false)}>キャンセル</Button><Button onClick={createTopic}>作成</Button></DialogFooter></DialogContent></Dialog><Toaster position="bottom-center" />
  </main>;
}

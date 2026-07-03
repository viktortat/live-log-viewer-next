"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { FileEntry } from "@/lib/types";

import { FileRow } from "./FileRow";

type OpenMap = Record<string, boolean>;

interface Node {
  file: FileEntry;
  kids: Node[];
  smt: number;
  live: boolean;
  count: number;
}

interface Props {
  files: FileEntry[];
  selected: FileEntry | null;
  onSelect: (file: FileEntry) => void;
}

function readMap(key: string): OpenMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as OpenMap;
  } catch {
    return {};
  }
}

function writeMap(key: string, value: OpenMap) {
  localStorage.setItem(key, JSON.stringify(value));
}

function containsPath(node: Node, pathname: string | null): boolean {
  return Boolean(pathname && (node.file.path === pathname || node.kids.some((kid) => containsPath(kid, pathname))));
}

function hiddenStats(node: Node): { count: number; live: boolean } {
  let count = 0;
  let live = false;
  const walk = (cur: Node) => {
    for (const kid of cur.kids) {
      count += 1;
      if (kid.live) live = true;
      walk(kid);
    }
  };
  walk(node);
  return { count, live };
}

export function Sidebar({ files, selected, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [tree, setTree] = useState(() => (typeof window === "undefined" ? true : localStorage.getItem("llvTree") !== "0"));
  const [projOpen, setProjOpen] = useState<OpenMap>(() => readMap("llvProjOpen"));
  const [nodeOpen, setNodeOpenState] = useState<OpenMap>(() => readMap("llvNodeOpen"));

  const q = query.toLowerCase();
  const shown = useMemo(
    () =>
      files.filter((file) =>
        q ? (file.path + file.title + file.project + (file.model ?? "")).toLowerCase().includes(q) : true,
      ),
    [files, q],
  );

  const treeData = useMemo(() => {
    const byPath = new Map<string, Node>();
    for (const file of shown) byPath.set(file.path, { file, kids: [], smt: file.mtime, live: file.activity === "live", count: 1 });
    const roots: Node[] = [];
    for (const node of byPath.values()) {
      const parent = node.file.parent ? byPath.get(node.file.parent) : null;
      if (parent && parent !== node) parent.kids.push(node);
      else roots.push(node);
    }
    const finish = (node: Node): Node => {
      node.kids = node.kids.map(finish).sort((a, b) => b.smt - a.smt);
      node.smt = Math.max(node.file.mtime, ...node.kids.map((kid) => kid.smt));
      node.live = node.file.activity === "live" || node.kids.some((kid) => kid.live);
      node.count = 1 + node.kids.reduce((sum, kid) => sum + kid.count, 0);
      return node;
    };
    const groups = new Map<string, Node[]>();
    for (const root of roots.map(finish)) {
      const key = root.file.project || "інше";
      groups.set(key, (groups.get(key) ?? []).concat(root));
    }
    return [...groups.entries()]
      .map(([project, nodes]) => [project, nodes.sort((a, b) => b.smt - a.smt)] as const)
      .sort((a, b) => a[0].localeCompare(b[0], "uk"));
  }, [shown]);

  const selectedPath = selected?.path ?? null;
  const activeSearch = q.length > 0;

  const projectDefaultOpen = (nodes: Node[]) =>
    activeSearch || nodes.some((node) => node.live || containsPath(node, selectedPath));
  const projectIsOpen = (project: string, nodes: Node[]) =>
    Object.hasOwn(projOpen, project) ? projOpen[project] : projectDefaultOpen(nodes);
  const nodeDefaultOpen = (node: Node) => activeSearch || node.live || containsPath(node, selectedPath);
  const nodeIsOpen = (node: Node) =>
    Object.hasOwn(nodeOpen, node.file.path) ? nodeOpen[node.file.path] : nodeDefaultOpen(node);

  const setProjectOpen = (project: string, open: boolean) => {
    setProjOpen((prev) => {
      const next = { ...prev, [project]: open };
      writeMap("llvProjOpen", next);
      return next;
    });
  };
  const persistNodeOpen = (pathname: string, open: boolean) => {
    setNodeOpenState((prev) => {
      const next = { ...prev, [pathname]: open };
      writeMap("llvNodeOpen", next);
      return next;
    });
  };

  const renderNode = (node: Node, depth: number): ReactNode[] => {
    const hasChildren = node.kids.length > 0;
    const open = hasChildren ? nodeIsOpen(node) : false;
    const hidden = hasChildren && !open ? hiddenStats(node) : { count: 0, live: false };
    const rows: ReactNode[] = [
      <FileRow
        key={node.file.path}
        file={node.file}
        active={selected?.path === node.file.path}
        depth={Math.min(depth, 4)}
        hasChildren={hasChildren}
        expanded={open}
        hiddenCount={hidden.count}
        hiddenLive={hidden.live}
        onToggle={() => persistNodeOpen(node.file.path, !open)}
        onSelect={onSelect}
      />,
    ];
    if (open) for (const kid of node.kids) rows.push(...renderNode(kid, depth + 1));
    return rows;
  };

  const flat = shown.slice().sort((a, b) => b.mtime - a.mtime);

  return (
    <aside className="flex w-[340px] min-w-[270px] flex-col border-r border-line bg-panel">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3 text-[15px] font-bold">
        Логи
        <span className="flex-1" />
        <button
          className={`rounded-[10px] border border-line px-2.5 py-1 text-xs ${tree ? "bg-[#ecebfb] font-semibold text-accent" : "bg-panel"}`}
          onClick={() => {
            const next = !tree;
            setTree(next);
            localStorage.setItem("llvTree", next ? "1" : "0");
          }}
        >
          {tree ? "Дерево" : "Стрічка"}
        </button>
      </header>
      <input
        className="m-3 rounded-[10px] border border-line bg-bg px-3 py-2 text-[13px] outline-none"
        placeholder="Пошук…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {!tree
          ? flat.map((file) => (
              <FileRow key={file.path} file={file} active={selected?.path === file.path} flat onSelect={onSelect} />
            ))
          : treeData.map(([project, nodes]) => {
              const open = projectIsOpen(project, nodes);
              const total = nodes.reduce((sum, node) => sum + node.count, 0);
              const live = nodes.reduce((sum, node) => sum + (node.live ? 1 : 0), 0);
              return (
                <section key={project}>
                  <button
                    className="flex w-full select-none items-center gap-1.5 rounded-lg px-2.5 pb-1 pt-3.5 text-left text-[11px] font-bold uppercase tracking-[.5px] text-dim hover:text-ink"
                    onClick={() => setProjectOpen(project, !open)}
                  >
                    <span className="w-2.5 text-[9px]">{open ? "▼" : "▶"}</span>
                    <span className="truncate">{project}</span>
                    <span className="ml-auto text-[10.5px] font-semibold normal-case tracking-normal">
                      {live ? <span className="font-bold text-ok">{live} live</span> : null}
                      {live ? " · " : ""}
                      {open ? total : `+${total}`}
                    </span>
                  </button>
                  {open ? nodes.flatMap((node) => renderNode(node, 0)) : null}
                </section>
              );
            })}
      </div>
    </aside>
  );
}

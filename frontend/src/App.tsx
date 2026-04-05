import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  File,
  FileText,
  Folder,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Menu,
  Moon,
  Pencil,
  Plus,
  Quote,
  Redo2,
  Save,
  Search,
  Strikethrough,
  Sun,
  Underline,
  Undo2,
} from "lucide-react";
import {
  createEntry,
  fetchFile,
  fetchPlantUmlUrl,
  fetchTree,
  saveFile,
  uploadImage,
} from "./lib/api";
import { htmlToMarkdown, markdownToHtml, normalizeImageSources } from "./lib/markdown";
import type { FilePayload, TreeNode } from "./lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";
type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type HeadingSelect = "p" | HeadingLevel;
type ImageSelection = {
  element: HTMLImageElement;
  width: number;
} | null;

type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  ordered: boolean;
  unordered: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
  justifyRight: boolean;
  quote: boolean;
};

const EMPTY_FORMAT_STATE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  ordered: false,
  unordered: false,
  justifyLeft: true,
  justifyCenter: false,
  justifyRight: false,
  quote: false,
};
const DEFAULT_COLORS = ["#111111", "#ef4444", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed", "#ec4899"];

function cls(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function getParentDir(path: string): string {
  const unix = path.replaceAll("\\", "/");
  const parts = unix.split("/");
  parts.pop();
  return parts.join("/") || ".";
}

function closestImageFromNode(node: Node | null): HTMLImageElement | null {
  if (!node) return null;
  if (node instanceof HTMLImageElement) return node;
  if (node instanceof Element) {
    if (node.tagName.toLowerCase() === "img") return node as HTMLImageElement;
    return node.closest("img");
  }
  const parent = node.parentElement;
  return parent ? parent.closest("img") : null;
}

function headingIcon(level: HeadingLevel) {
  if (level === "h1") return <Heading1 size={14} />;
  if (level === "h2") return <Heading2 size={14} />;
  if (level === "h3") return <Heading3 size={14} />;
  if (level === "h4") return <span className="heading-token">H4</span>;
  if (level === "h5") return <span className="heading-token">H5</span>;
  return <span className="heading-token">H6</span>;
}

function getHeadingLabel(level: HeadingSelect | ""): string {
  if (!level) return "Heading";
  if (level === "p") return "Paragraph";
  return level.toUpperCase();
}

async function buildMarkdownPreviewHtml(sourceHtml: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<article>${sourceHtml}</article>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;

  const slugMap = new Map<string, number>();
  const makeSlug = (text: string) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u0400-\u04ff\s-]/g, "")
      .replace(/\s+/g, "-") || "section";
    const count = slugMap.get(base) || 0;
    slugMap.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) => {
    const level = Number(el.tagName.slice(1));
    const title = (el.textContent || "").trim() || `Heading ${level}`;
    if (!el.id) el.id = makeSlug(title);
    return { level, title, id: el.id };
  });

  const tocBlocks = Array.from(root.querySelectorAll("[data-toc='true']"));
  for (const tocBlock of tocBlocks) {
    const maxLevel = Math.min(6, Math.max(1, Number((tocBlock as HTMLElement).dataset.level || "3")));
    const entries = headings.filter((h) => h.level <= maxLevel);
    const nav = doc.createElement("nav");
    nav.className = "toc-preview";
    const title = doc.createElement("div");
    title.className = "toc-preview-title";
    title.textContent = "Table of Contents";
    nav.appendChild(title);
    const list = doc.createElement("ul");
    list.className = "toc-preview-list";
    entries.forEach((entry) => {
      const li = doc.createElement("li");
      li.style.marginLeft = `${(entry.level - 1) * 14}px`;
      const link = doc.createElement("a");
      link.href = `#${entry.id}`;
      link.textContent = entry.title;
      li.appendChild(link);
      list.appendChild(li);
    });
    nav.appendChild(list);
    tocBlock.replaceWith(nav);
  }

  const pumlBlocks = Array.from(root.querySelectorAll("pre")).filter((pre) => {
    const lang = (pre.getAttribute("data-lang") || "").toLowerCase();
    const text = (pre.textContent || "").toLowerCase();
    return lang === "puml" || text.includes("@startuml");
  });

  await Promise.all(
    pumlBlocks.map(async (pre) => {
      const source = (pre.textContent || "").trim();
      if (!source) return;
      try {
        const url = await fetchPlantUmlUrl(source);
        const wrapper = doc.createElement("figure");
        wrapper.className = "puml-preview-block";
        const image = doc.createElement("img");
        image.src = url;
        image.alt = "PlantUML diagram";
        image.className = "puml-preview-image";
        wrapper.appendChild(image);
        pre.replaceWith(wrapper);
      } catch {
        const fallback = doc.createElement("pre");
        fallback.textContent = source;
        pre.replaceWith(fallback);
      }
    }),
  );

  return root.innerHTML;
}

function TreeItem({
  node,
  depth,
  opened,
  setOpened,
  onSelect,
  selectedPath,
  query,
}: {
  node: TreeNode;
  depth: number;
  opened: Set<string>;
  setOpened: (next: Set<string>) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  query: string;
}) {
  const isFolder = node.kind === "folder";
  const isOpen = opened.has(node.path);
  const isSelected = selectedPath === node.path;
  const match = node.name.toLowerCase().includes(query.toLowerCase());

  const visibleChildren = (node.children || []).filter((child) =>
    query ? child.name.toLowerCase().includes(query.toLowerCase()) || child.kind === "folder" : true,
  );

  if (!match && query && !isFolder) {
    return null;
  }

  return (
    <div>
      <button
        className={`tree-item ${isSelected ? "active" : ""}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => {
          if (isFolder) {
            const next = new Set(opened);
            if (isOpen) next.delete(node.path);
            else next.add(node.path);
            setOpened(next);
            return;
          }
          onSelect(node.path);
        }}
      >
        <span className="tree-chevron">
          {isFolder ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </span>
        <span className="tree-icon">{isFolder ? <Folder size={14} /> : <File size={14} />}</span>
        <span className="tree-label">{node.name}</span>
      </button>
      {isFolder && isOpen && visibleChildren.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          opened={opened}
          setOpened={setOpened}
          onSelect={onSelect}
          selectedPath={selectedPath}
          query={query}
        />
      ))}
    </div>
  );
}

function WorkspaceApp() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState("");

  const [file, setFile] = useState<FilePayload | null>(null);
  const [editorSeed, setEditorSeed] = useState(0);
  const [mdWorkingHtml, setMdWorkingHtml] = useState("");
  const [mdPreviewHtml, setMdPreviewHtml] = useState("");
  const [codeText, setCodeText] = useState("");
  const [pumlPreviewUrl, setPumlPreviewUrl] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isDark, setIsDark] = useState(false);
  const [editMode, setEditMode] = useState(true);
  const [headingValue, setHeadingValue] = useState<HeadingSelect | "">("");
  const [selectedImage, setSelectedImage] = useState<ImageSelection>(null);
  const [formatState, setFormatState] = useState<FormatState>(EMPTY_FORMAT_STATE);
  const [textColor, setTextColor] = useState("#111111");
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const [palettePosition, setPalettePosition] = useState({ top: 0, left: 0 });

  const editorRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const colorButtonRef = useRef<HTMLButtonElement | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const lastRangeRef = useRef<Range | null>(null);
  const dragResizeRef = useRef<{ image: HTMLImageElement; startX: number; startWidth: number } | null>(null);

  const refreshTree = async () => {
    const payload = await fetchTree();
    setTree(payload);
    setOpened((prev) => new Set([...prev, payload.path]));
  };

  const readEditorHtml = (): string => editorRef.current?.innerHTML ?? mdWorkingHtml;
  const clearSelection = () => {
    const selection = document.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    lastRangeRef.current = null;
  };

  const isEditorSelection = (selection: Selection | null): boolean => {
    if (!selection || !selection.anchorNode || !editorRef.current) return false;
    return editorRef.current.contains(selection.anchorNode);
  };

  const restoreSelection = () => {
    if (!lastRangeRef.current) return;
    const selection = document.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(lastRangeRef.current);
  };

  const syncFormatState = () => {
    if (!editMode || file?.kind !== "md") {
      setFormatState(EMPTY_FORMAT_STATE);
      return;
    }
    const block = String(document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, "");
    let heading: HeadingSelect | "" = "";
    if (block === "p" || block === "div") heading = "p";
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(block)) {
      heading = block as HeadingLevel;
    }
    setHeadingValue(heading);
    setFormatState({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
      ordered: document.queryCommandState("insertOrderedList"),
      unordered: document.queryCommandState("insertUnorderedList"),
      justifyLeft: document.queryCommandState("justifyLeft"),
      justifyCenter: document.queryCommandState("justifyCenter"),
      justifyRight: document.queryCommandState("justifyRight"),
      quote: block === "blockquote",
    });
  };

  useEffect(() => {
    refreshTree().catch(() => setSaveState("error"));

    const dark = window.localStorage.getItem("theme") === "dark";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  useEffect(() => {
    if (!file || file.kind !== "md") return;
    if (!editorRef.current) return;
    editorRef.current.innerHTML = mdWorkingHtml;
  }, [file?.path, file?.kind, editorSeed]);

  useEffect(() => {
    const handler = () => {
      if (!editMode || file?.kind !== "md") {
        setSelectedImage(null);
        return;
      }
      const selection = document.getSelection();
      if (selection && selection.rangeCount > 0 && isEditorSelection(selection)) {
        lastRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
      const image = closestImageFromNode(selection?.anchorNode ?? null);
      if (!image) {
        setSelectedImage(null);
      } else {
        const width = image.width || parseInt(image.style.width || "0", 10) || 320;
        setSelectedImage({ element: image, width });
      }
      syncFormatState();
    };

    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [editMode, file?.kind]);

  useEffect(() => {
    if (!colorPaletteOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (paletteRef.current?.contains(target)) return;
      if (colorButtonRef.current?.contains(target)) return;
      setColorPaletteOpen(false);
    };
    window.addEventListener("mousedown", closeOnOutside);
    return () => window.removeEventListener("mousedown", closeOnOutside);
  }, [colorPaletteOpen]);

  const selectedPath = file?.path ?? null;

  const openFile = async (path: string) => {
    const payload = await fetchFile(path);
    setFile(payload);
    setSaveState("idle");
    setEditMode(true);
    setSelectedImage(null);
    setPumlPreviewUrl("");

    if (payload.kind === "md") {
      const html = normalizeImageSources(markdownToHtml(payload.content));
      setMdWorkingHtml(html);
      setMdPreviewHtml(html);
      setEditorSeed((value) => value + 1);
    } else {
      setCodeText(payload.content);
    }
  };

  const saveCurrent = async () => {
    if (!file) return;
    setSaveState("saving");
    try {
      if (file.kind === "md") {
        const html = readEditorHtml();
        setMdWorkingHtml(html);
        const markdown = htmlToMarkdown(html);
        await saveFile(file.path, markdown);
      } else {
        await saveFile(file.path, codeText);
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1300);
    } catch {
      setSaveState("error");
    }
  };

  const exec = (command: string, value?: string) => {
    if (!editMode || file?.kind !== "md") return;
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    setMdWorkingHtml(readEditorHtml());
    syncFormatState();
  };

  const onUploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadFile = event.target.files?.[0];
    if (!uploadFile || !file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image"));
      reader.readAsDataURL(uploadFile);
    });

    const targetPath = await uploadImage(getParentDir(file.path), uploadFile.name, dataUrl);
    exec("insertImage", `/api/raw-file?path=${encodeURIComponent(targetPath)}`);
    event.target.value = "";
  };

  const onCreateEntry = async (entryType: "folder" | "md" | "puml") => {
    const base = tree?.path || ".";
    const selectedFolder = file ? getParentDir(file.path) : base;
    const namePrompt =
      entryType === "folder" ? "Folder name" : entryType === "md" ? "Markdown file name" : "PUML file name";
    const rawName = window.prompt(namePrompt);
    if (!rawName) return;

    let finalName = rawName.trim();
    if (!finalName) return;
    if (entryType !== "folder" && !finalName.endsWith(`.${entryType}`)) {
      finalName = `${finalName}.${entryType}`;
    }

    await createEntry(selectedFolder, finalName, entryType);
    await refreshTree();
  };

  const applyHeading = (heading: HeadingSelect) => {
    setHeadingValue(heading);
    if (heading === "p") {
      exec("removeFormat");
      exec("formatBlock", "<p>");
      return;
    }
    exec("formatBlock", `<${heading}>`);
  };

  const setImageAlign = (align: "left" | "center" | "right") => {
    if (!selectedImage) return;
    selectedImage.element.style.display = "block";
    if (align === "left") {
      selectedImage.element.style.marginLeft = "0px";
      selectedImage.element.style.marginRight = "auto";
    }
    if (align === "center") {
      selectedImage.element.style.marginLeft = "auto";
      selectedImage.element.style.marginRight = "auto";
    }
    if (align === "right") {
      selectedImage.element.style.marginLeft = "auto";
      selectedImage.element.style.marginRight = "0px";
    }
    setMdWorkingHtml(readEditorHtml());
  };

  const applyTextColor = (color: string) => {
    if (!canFormat) return;
    editorRef.current?.focus();
    restoreSelection();
    const selection = document.getSelection();
    const hasEditorSelection = isEditorSelection(selection);
    if (!selection || selection.rangeCount === 0 || !hasEditorSelection) {
      setColorPaletteOpen(false);
      return;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      setColorPaletteOpen(false);
      return;
    }
    setTextColor(color);
    const fragment = range.extractContents();
    const span = document.createElement("span");
    span.style.color = color;
    span.appendChild(fragment);
    range.insertNode(span);
    setMdWorkingHtml(readEditorHtml());
    syncFormatState();
    clearSelection();
    setColorPaletteOpen(false);
  };

  const insertToc = () => {
    if (!canFormat) return;
    const raw = window.prompt("TOC max heading level (1-6)", "3");
    const level = Math.min(6, Math.max(1, Number(raw || "3") || 3));
    exec(
      "insertHTML",
      `<div class="toc-chip" data-toc="true" data-level="${level}" contenteditable="false">TOC added (H1..H${level})</div><p><br/></p>`,
    );
  };

  const toggleEditMode = async () => {
    if (!file) return;
    if (editMode) {
      try {
        if (file.kind === "md") {
          const html = readEditorHtml();
          setMdWorkingHtml(html);
          const preview = await buildMarkdownPreviewHtml(html);
          setMdPreviewHtml(preview);
        } else {
          const url = await fetchPlantUmlUrl(codeText);
          setPumlPreviewUrl(url);
        }
      } catch {
        setSaveState("error");
      }
      setEditMode(false);
      return;
    }
    setEditMode(true);
    if (file.kind === "md") {
      setEditorSeed((value) => value + 1);
    }
  };

  const insertPumlTemplateMd = () => {
    exec(
      "insertHTML",
      "<p><br/></p><pre data-lang='puml'><code>Alice -> Bob: Hello\nBob --> Alice: Hi</code></pre><p><br/></p>",
    );
  };

  const toggleQuote = () => {
    if (!canFormat) return;
    const block = String(document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, "");
    if (block === "blockquote") {
      exec("formatBlock", "<p>");
      return;
    }
    exec("formatBlock", "<blockquote>");
  };

  const escapeInline = (input: string): string =>
    input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const applyTodoToSelection = () => {
    if (!canFormat) return;
    const selection = document.getSelection();
    const text = selection?.toString().trim() || "";
    const body = text ? escapeInline(text) : "todo";
    exec(
      "insertHTML",
      `<div class="todo-item" data-todo="true"><input type="checkbox" contenteditable="false" /> <span>${body}</span></div><p><br/></p>`,
    );
  };

  const insertPumlTemplate = (template: string) => {
    if (!codeRef.current || !editMode) return;
    const textarea = codeRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${codeText.slice(0, start)}${template}${codeText.slice(end)}`;
    setCodeText(next);

    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + template.length;
      textarea.setSelectionRange(pos, pos);
    });
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editMode) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    const selection = document.getSelection();
    const anchor = selection?.anchorNode;
    const quote = anchor instanceof Element ? anchor.closest("blockquote") : anchor?.parentElement?.closest("blockquote");
    if (!quote) return;
    event.preventDefault();
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br/>";
    quote.parentNode?.insertBefore(paragraph, quote.nextSibling);
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    lastRangeRef.current = range.cloneRange();
  };

  const onEditorMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    const rect = target.getBoundingClientRect();
    const nearRight = rect.right - event.clientX < 18;
    const nearBottom = rect.bottom - event.clientY < 18;
    if (!nearRight || !nearBottom) return;
    event.preventDefault();
    dragResizeRef.current = {
      image: target,
      startX: event.clientX,
      startWidth: target.width || rect.width,
    };
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragResizeRef.current) return;
      const delta = event.clientX - dragResizeRef.current.startX;
      const nextWidth = Math.max(120, Math.min(1200, Math.round(dragResizeRef.current.startWidth + delta)));
      const image = dragResizeRef.current.image;
      image.style.width = `${nextWidth}px`;
      image.setAttribute("width", String(nextWidth));
      setSelectedImage({ element: image, width: nextWidth });
      setMdWorkingHtml(readEditorHtml());
    };

    const onUp = () => {
      dragResizeRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [mdWorkingHtml]);

  const saveLabel = useMemo(() => {
    if (saveState === "saving") return "Saving...";
    if (saveState === "saved") return "Saved";
    if (saveState === "error") return "Error";
    return "Save";
  }, [saveState]);

  const canFormat = file?.kind === "md" && editMode;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-head">
          <div className="logo-circle">
            <FileText size={16} />
          </div>
          <div>
            <p className="workspace-title">My Workspace</p>
            <p className="workspace-sub">Personal</p>
          </div>
        </div>

        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
          />
        </div>

        <div className="tree-actions">
          <button className="icon-btn small" title="New folder" onClick={() => onCreateEntry("folder")}>
            <FolderPlus size={14} /> Folder
          </button>
          <button className="icon-btn small" title="New markdown" onClick={() => onCreateEntry("md")}>
            <Plus size={14} /> MD
          </button>
          <button className="icon-btn small" title="New puml" onClick={() => onCreateEntry("puml")}>
            <Plus size={14} /> PUML
          </button>
        </div>

        <div className="tree-wrap">
          {tree ? (
            <TreeItem
              node={tree}
              depth={0}
              opened={opened}
              setOpened={setOpened}
              onSelect={openFile}
              selectedPath={selectedPath}
              query={search}
            />
          ) : (
            <p className="empty-message">Loading tree...</p>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-btn" onClick={() => setSidebarOpen((prev) => !prev)}>
              <Menu size={16} />
            </button>
            <span className="doc-title">{file?.path ?? "Choose a file"}</span>
          </div>

          <div className="topbar-right">
            <button
              className="icon-btn"
              onClick={() => {
                const next = !isDark;
                setIsDark(next);
                document.documentElement.classList.toggle("dark", next);
                window.localStorage.setItem("theme", next ? "dark" : "light");
              }}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="secondary-btn" onClick={toggleEditMode}>
              {editMode ? <Eye size={15} /> : <Pencil size={15} />} {editMode ? "Preview" : "Edit"}
            </button>
            {editMode && (
              <button className="primary-btn" disabled={!file || saveState === "saving"} onClick={saveCurrent}>
                <Save size={15} /> {saveLabel}
              </button>
            )}
          </div>
        </header>

        {file?.kind === "md" && (
          <div className="toolbar">
            <button className="icon-btn" disabled={!canFormat} onClick={() => exec("undo")}>
              <Undo2 size={15} />
            </button>
            <button className="icon-btn" disabled={!canFormat} onClick={() => exec("redo")}>
              <Redo2 size={15} />
            </button>
            <span className="sep" />

            <label className="block-select-wrap" onMouseDown={(event) => event.stopPropagation()}>
              {headingValue && headingValue !== "p" ? headingIcon(headingValue) : <span className="heading-token">P</span>}
              <select
                className="block-select"
                disabled={!canFormat}
                value={headingValue}
                onChange={(event) => applyHeading(event.target.value as HeadingSelect)}
              >
                <option value="" disabled>
                  {getHeadingLabel(headingValue)}
                </option>
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="h4">Heading 4</option>
                <option value="h5">Heading 5</option>
                <option value="h6">Heading 6</option>
              </select>
            </label>

            <span className="sep" />
            <button className={cls("icon-btn", formatState.bold && "active")} disabled={!canFormat} onClick={() => exec("bold")}>
              <Bold size={15} />
            </button>
            <button className={cls("icon-btn", formatState.italic && "active")} disabled={!canFormat} onClick={() => exec("italic")}>
              <Italic size={15} />
            </button>
            <button className={cls("icon-btn", formatState.underline && "active")} disabled={!canFormat} onClick={() => exec("underline")}>
              <Underline size={15} />
            </button>
            <button className={cls("icon-btn", formatState.strike && "active")} disabled={!canFormat} onClick={() => exec("strikeThrough")}>
              <Strikethrough size={15} />
            </button>

            <span className="sep" />
            <div className="color-popover">
              <button
                ref={colorButtonRef}
                className="icon-btn"
                disabled={!canFormat}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!colorPaletteOpen) {
                    const rect = colorButtonRef.current?.getBoundingClientRect();
                    if (rect) {
                      setPalettePosition({ top: rect.bottom + 8, left: rect.left });
                    }
                  }
                  setColorPaletteOpen((value) => !value);
                }}
              >
                <span className="swatch active" style={{ background: textColor }} />
              </button>
              {colorPaletteOpen && (
                <div
                  ref={paletteRef}
                  className="palette-panel floating"
                  style={{ top: `${palettePosition.top}px`, left: `${palettePosition.left}px` }}
                >
                  <div className="color-swatches">
                    {DEFAULT_COLORS.map((color) => (
                      <button
                        key={color}
                        className={cls("swatch", textColor === color && "active")}
                        style={{ background: color }}
                        disabled={!canFormat}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyTextColor(color)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              className="icon-btn"
              disabled={!canFormat}
              onClick={() => {
                const url = window.prompt("Link URL");
                if (url) exec("createLink", url);
              }}
            >
              <Link size={15} />
            </button>
            <button className="icon-btn" disabled={!canFormat} onClick={() => exec("insertHTML", "<pre><code>// code</code></pre><p><br/></p>")}>
              <Code size={15} />
            </button>

            <span className="sep" />
            <button className={cls("icon-btn", formatState.justifyLeft && "active")} disabled={!canFormat} onClick={() => exec("justifyLeft")}>
              <AlignLeft size={15} />
            </button>
            <button className={cls("icon-btn", formatState.justifyCenter && "active")} disabled={!canFormat} onClick={() => exec("justifyCenter")}>
              <AlignCenter size={15} />
            </button>
            <button className={cls("icon-btn", formatState.justifyRight && "active")} disabled={!canFormat} onClick={() => exec("justifyRight")}>
              <AlignRight size={15} />
            </button>

            <span className="sep" />
            <button className={cls("icon-btn", formatState.unordered && "active")} disabled={!canFormat} onClick={() => exec("insertUnorderedList")}>
              <List size={15} />
            </button>
            <button className={cls("icon-btn", formatState.ordered && "active")} disabled={!canFormat} onClick={() => exec("insertOrderedList")}>
              <ListOrdered size={15} />
            </button>
            <button className="icon-btn" disabled={!canFormat} onClick={applyTodoToSelection}>
              <CheckSquare size={15} />
            </button>
            <button className={cls("icon-btn", formatState.quote && "active")} disabled={!canFormat} onClick={toggleQuote}>
              <Quote size={15} />
            </button>
            <button className="icon-btn" disabled={!canFormat} onClick={() => imageInputRef.current?.click()}>
              <Image size={15} />
            </button>
            <button className="secondary-btn" disabled={!canFormat} title="Insert PlantUML block" onClick={insertPumlTemplateMd}>
              PlantUML
            </button>
            <button className="secondary-btn" disabled={!canFormat} onClick={insertToc}>
              TOC
            </button>

            {selectedImage && (
              <>
                <span className="sep" />
                <span className="image-size-value">{selectedImage.width}px</span>
                <button className="icon-btn small" disabled={!canFormat} onClick={() => setImageAlign("left")}>L</button>
                <button className="icon-btn small" disabled={!canFormat} onClick={() => setImageAlign("center")}>C</button>
                <button className="icon-btn small" disabled={!canFormat} onClick={() => setImageAlign("right")}>R</button>
                <span className="image-size-value">drag bottom-right corner</span>
              </>
            )}

            <input ref={imageInputRef} type="file" accept="image/*" onChange={onUploadImage} hidden />
          </div>
        )}

        {file?.kind === "puml" && (
          <div className="toolbar puml-toolbar">
            <button className="secondary-btn" disabled={!editMode} onClick={() => insertPumlTemplate("@startuml\nAlice -> Bob: Hello\n@enduml\n")}>Sequence</button>
            <button className="secondary-btn" disabled={!editMode} onClick={() => insertPumlTemplate("@startuml\nclass User\nclass Account\nUser --> Account\n@enduml\n")}>Class</button>
            <button className="secondary-btn" disabled={!editMode} onClick={() => insertPumlTemplate("@startuml\nactor User\nUser --> (Login)\n@enduml\n")}>Use Case</button>
            <button className="secondary-btn" disabled={!editMode} onClick={() => insertPumlTemplate("@startuml\nstart\n:Do work;\nstop\n@enduml\n")}>Activity</button>
          </div>
        )}

        <section className="editor-zone">
          {!file ? (
            <div className="empty-message">Open a `.md` or `.puml` file from the sidebar.</div>
          ) : file.kind === "puml" ? (
            editMode ? (
              <textarea
                ref={codeRef}
                className="code-editor"
                value={codeText}
                readOnly={false}
                onChange={(event) => setCodeText(event.target.value)}
              />
            ) : (
              <div className="puml-preview-wrap">
                {pumlPreviewUrl ? (
                  <img className="puml-preview-image" src={pumlPreviewUrl} alt="PlantUML preview" />
                ) : (
                  <p className="empty-message">Click Build_PlantUml to render diagram.</p>
                )}
              </div>
            )
          ) : editMode ? (
            <div
              key={editorSeed}
              ref={editorRef}
              className="rich-editor editable"
              contentEditable
              suppressContentEditableWarning
              onInput={(event) => setMdWorkingHtml((event.currentTarget as HTMLDivElement).innerHTML)}
              onKeyDown={onEditorKeyDown}
              onMouseDown={onEditorMouseDown}
              onClick={(event) => {
                const target = event.target;
                if (target instanceof HTMLImageElement) {
                  const width = target.width || parseInt(target.style.width || "0", 10) || 320;
                  setSelectedImage({ element: target, width });
                }
              }}
            />
          ) : (
            <div className="rich-editor preview" dangerouslySetInnerHTML={{ __html: mdPreviewHtml }} />
          )}
        </section>
      </main>
    </div>
  );
}

export default WorkspaceApp;

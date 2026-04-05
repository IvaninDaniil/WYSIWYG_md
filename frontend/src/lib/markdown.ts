function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseImageAttrs(rawAttrs?: string): { width?: number; align?: "left" | "center" | "right" } {
  if (!rawAttrs) return {};
  const attrs = rawAttrs
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const result: { width?: number; align?: "left" | "center" | "right" } = {};
  for (const attr of attrs) {
    const [key, value] = attr.split("=").map((v) => v.trim());
    if (key === "w") {
      const parsed = parseInt(value || "0", 10);
      if (parsed > 0) result.width = parsed;
    }
    if (key === "a" && (value === "left" || value === "center" || value === "right")) {
      result.align = value;
    }
  }
  return result;
}

function imageAlignStyle(align?: "left" | "center" | "right"): string {
  if (align === "center") return "display:block;margin-left:auto;margin-right:auto;";
  if (align === "right") return "display:block;margin-left:auto;margin-right:0;";
  if (align === "left") return "display:block;margin-left:0;margin-right:auto;";
  return "";
}

function inlineMarkdownToHtml(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]+)\})?/g, (_m, alt, src, attrs) => {
      const parsed = parseImageAttrs(attrs);
      const styleParts: string[] = [];
      if (parsed.width) styleParts.push(`width:${parsed.width}px;`);
      const alignStyle = imageAlignStyle(parsed.align);
      if (alignStyle) styleParts.push(alignStyle);
      const style = styleParts.join("");
      const widthAttr = parsed.width ? ` width="${parsed.width}"` : "";
      const styleAttr = style ? ` style="${style}"` : "";
      return `<img alt="${alt}" src="${src}"${widthAttr}${styleAttr} />`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function tocTokenToHtml(line: string): string | null {
  const match = line.trim().match(/^\[\[TOC(?::(\d))?\]\]$/i);
  if (!match) return null;
  const level = Math.min(6, Math.max(1, parseInt(match[1] || "3", 10)));
  return `<div class="toc-chip" data-toc="true" data-level="${level}" contenteditable="false">TOC added (H1..H${level})</div>`;
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];

  let inCode = false;
  let codeLang = "";
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeList();
      if (inCode) {
        output.push("</code></pre>");
        inCode = false;
        codeLang = "";
      } else {
        inCode = true;
        codeLang = line.replace("```", "").trim();
        output.push(`<pre data-lang="${escapeHtml(codeLang)}"><code>`);
      }
      continue;
    }

    if (inCode) {
      output.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (line.trim().length === 0) {
      closeList();
      output.push("<p><br /></p>");
      continue;
    }

    const tocHtml = tocTokenToHtml(line);
    if (tocHtml) {
      closeList();
      output.push(tocHtml);
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      output.push(`<h3>${inlineMarkdownToHtml(escapeHtml(line.slice(4)))}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      output.push(`<h2>${inlineMarkdownToHtml(escapeHtml(line.slice(3)))}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      output.push(`<h1>${inlineMarkdownToHtml(escapeHtml(line.slice(2)))}</h1>`);
      continue;
    }

    if (line.startsWith("> ")) {
      closeList();
      output.push(`<blockquote>${inlineMarkdownToHtml(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }

    if (/^- \[( |x|X)\] /.test(line)) {
      closeList();
      const checked = /- \[(x|X)\] /.test(line);
      const text = line.replace(/^- \[( |x|X)\] /, "");
      output.push(
        `<div class="todo-item" data-todo="true"><input type="checkbox" contenteditable="false"${checked ? " checked" : ""} /> <span>${inlineMarkdownToHtml(
          escapeHtml(text),
        )}</span></div>`,
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      if (listType !== "ol") {
        closeList();
        output.push("<ol>");
        listType = "ol";
      }
      output.push(`<li>${inlineMarkdownToHtml(escapeHtml(line.replace(/^\d+\.\s/, "")))}</li>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (listType !== "ul") {
        closeList();
        output.push("<ul>");
        listType = "ul";
      }
      output.push(`<li>${inlineMarkdownToHtml(escapeHtml(line.slice(2)))}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${inlineMarkdownToHtml(escapeHtml(line))}</p>`);
  }

  closeList();
  if (inCode) {
    output.push("</code></pre>");
  }

  return output.join("\n");
}

export function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<article>${html}</article>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;

  const nodeToMarkdown = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(/\u00a0/g, " ");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node as HTMLElement;
    const text = Array.from(element.childNodes).map(nodeToMarkdown).join("");

    switch (element.tagName.toLowerCase()) {
      case "h1":
        return `# ${text.trim()}\n\n`;
      case "h2":
        return `## ${text.trim()}\n\n`;
      case "h3":
        return `### ${text.trim()}\n\n`;
      case "p":
        return `${text.trim()}\n\n`;
      case "br":
        return "\n";
      case "strong":
      case "b":
        return `**${text}**`;
      case "em":
      case "i":
        return `*${text}*`;
      case "code":
        if (element.parentElement?.tagName.toLowerCase() === "pre") {
          return text;
        }
        return `\`${text}\``;
      case "pre": {
        const first = element.firstElementChild;
        const codeNode = first && first.tagName.toLowerCase() === "code" ? first : null;
        const code = (codeNode?.textContent || element.textContent || "").replace(/\n$/, "");
        const lang = element.dataset.lang || "";
        return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      }
      case "blockquote":
        return text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")
          .concat("\n\n");
      case "ul":
        return Array.from(element.children)
          .map((li) => `- ${nodeToMarkdown(li).trim()}`)
          .join("\n")
          .concat("\n\n");
      case "ol":
        return Array.from(element.children)
          .map((li, index) => `${index + 1}. ${nodeToMarkdown(li).trim()}`)
          .join("\n")
          .concat("\n\n");
      case "li":
        return text;
      case "a": {
        const href = element.getAttribute("href") || "#";
        return `[${text || href}](${href})`;
      }
      case "img": {
        const alt = element.getAttribute("alt") || "image";
        const src = element.getAttribute("src") || "";
        const widthAttr = element.getAttribute("width");
        const styleWidth = parseInt(element.style.width || "0", 10);
        const width = parseInt(widthAttr || "0", 10) || styleWidth;
        let align: "left" | "center" | "right" | undefined;
        const styleMarginLeft = element.style.marginLeft;
        const styleMarginRight = element.style.marginRight;
        if (styleMarginLeft === "auto" && styleMarginRight === "auto") align = "center";
        if (styleMarginLeft === "auto" && styleMarginRight === "0px") align = "right";
        if (styleMarginLeft === "0px" && styleMarginRight === "auto") align = "left";
        const attrs: string[] = [];
        if (width > 0) attrs.push(`w=${width}`);
        if (align) attrs.push(`a=${align}`);
        const suffix = attrs.length > 0 ? `{${attrs.join(",")}}` : "";
        if (src.includes("/api/raw-file?path=")) {
          const rawPath = decodeURIComponent(src.split("path=")[1] || "");
          return `![${alt}](${rawPath})${suffix}`;
        }
        return `![${alt}](${src})${suffix}`;
      }
      case "div": {
        if (element.dataset.toc === "true") {
          const level = parseInt(element.dataset.level || "3", 10);
          return `[[TOC:${Math.min(6, Math.max(1, level))}]]\n\n`;
        }
        if (element.dataset.todo === "true") {
          const input = element.querySelector("input[type='checkbox']") as HTMLInputElement | null;
          const span = element.querySelector("span");
          const checked = input?.checked ? "x" : " ";
          const textValue = (span?.textContent || "").trim();
          return `- [${checked}] ${textValue}\n\n`;
        }
        return `${text.trim()}\n\n`;
      }
      default:
        return text;
    }
  };

  const markdown = Array.from(root.childNodes)
    .map(nodeToMarkdown)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return `${markdown}\n`;
}

export function normalizeImageSources(html: string): string {
  return html.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (_whole, left, src, right) => {
    if (src.startsWith("/api/raw-file?path=")) {
      return `<img${left}src="${src}"${right}>`;
    }
    if (/^[A-Za-z]:\\/.test(src) || src.startsWith("/")) {
      return `<img${left}src="/api/raw-file?path=${encodeURIComponent(src)}"${right}>`;
    }
    return `<img${left}src="${src}"${right}>`;
  });
}

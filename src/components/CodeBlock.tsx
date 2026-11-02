import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import {
  Copy,
  CheckCheck,
  ChevronUp,
  ChevronDown,
  Play,
  Maximize2,
  Minimize2,
  Download,
  Code2,
  ArrowDown
} from "lucide-react";
import { copyToClipboard, getDeviconUrl } from "../utils/devicons";
import { HtmlPreviewModal } from "./HtmlPreviewModal";

const highlightCache = new Map<string, string>();

const highlightLine = (line: string) => {
  if (!line) return "";
  const keywords = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "class", "import", "export", "from", "default", "interface", "type",
    "public", "private", "protected", "async", "await", "new", "this", "super",
    "extends", "implements", "true", "false", "null", "undefined", "switch",
    "case", "break", "continue", "DOCTYPE", "html", "head", "body", "meta",
    "title", "style", "script", "link", "div", "span", "p", "a", "def", "print", "in", "range"
  ]);

  let result = "";
  let i = 0;
  const escapeHtml = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  while (i < line.length) {
    if (line.startsWith('//', i) || line.startsWith('/*', i) || line.startsWith('#', i)) {
      result += `<span style="color: #6a9955; font-style: italic">${escapeHtml(line.substring(i))}</span>`;
      break;
    }

    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let end = i + 1;
      while (end < line.length && line[end] !== quote) {
        if (line[end] === '\\') end++;
        end++;
      }
      if (end < line.length) end++;
      result += `<span style="color: #ce9178">${escapeHtml(line.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    if (/[a-zA-Z_$]/.test(line[i])) {
      let end = i + 1;
      while (end < line.length && /[a-zA-Z0-9_$-]/.test(line[end])) {
        end++;
      }
      const word = line.substring(i, end);
      let j = end;
      while (j < line.length && /\s/.test(line[j])) j++;
      if (j < line.length && line[j] === '(') {
        result += `<span style="color: #dcdcaa; font-weight: bold">${escapeHtml(word)}</span>`;
      } else if (keywords.has(word) || keywords.has(word.toLowerCase())) {
        result += `<span style="color: #c586c0; font-weight: bold">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
      i = end;
      continue;
    }

    if (/[0-9]/.test(line[i])) {
      let end = i + 1;
      while (end < line.length && /[0-9.]/.test(line[end])) end++;
      result += `<span style="color: #b5cea8">${escapeHtml(line.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    if (line[i] === '<' || line[i] === '>') {
      result += `<span style="color: #808080">${escapeHtml(line[i])}</span>`;
      i++;
      continue;
    }

    result += escapeHtml(line[i]);
    i++;
  }
  return result;
};

const highlightLineCached = (line: string) => {
  if (!line) return "";
  if (line.length > 2000) return line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cached = highlightCache.get(line);
  if (cached !== undefined) return cached;
  const result = highlightLine(line);
  if (highlightCache.size > 8000) highlightCache.clear();
  highlightCache.set(line, result);
  return result;
};

const NativeHighlighter = memo(({ code, codeWrap, isGenerating }: { code: string, codeWrap?: boolean, isGenerating?: boolean }) => {
  const lines = useMemo(() => {
    if (!code) return [""];
    const rawLines = code.split("\n");
    if (code.length > 300000) {
      return rawLines.map(l => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
    return rawLines.map(highlightLineCached);
  }, [code]);

  return (
    <div className="w-full overflow-x-auto bg-transparent">
      <table className="w-full border-collapse font-mono text-[13px] leading-[1.6]">
        <tbody>
          {lines.map((lineHtml, i) => (
            <tr key={i} className="hover:bg-white/[0.03] transition-colors group">
              <td
                className="select-none text-right pr-3 pl-2 text-neutral-600 group-hover:text-neutral-400 align-top shrink-0 font-mono text-[11px] py-0.5 bg-transparent whitespace-nowrap"
                style={{ width: "1%" }}
              >
                {i + 1}
              </td>
              <td
                className={`pl-2 pr-4 align-top font-mono py-0.5 text-neutral-200 ${
                  codeWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                }`}
                dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export const CodeBlock = memo(function CodeBlock({
  language,
  code,
  userSettings,
  isGenerating,
  chatId,
}: {
  language: string;
  code: string;
  userSettings?: any;
  isGenerating?: boolean;
  chatId?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "success">("idle");
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [iconError, setIconError] = useState(false);

  const deviconUrl = useMemo(() => getDeviconUrl(language), [language]);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => (code ? code.split("\n").length : 0), [code]);

  const handleCopy = async () => {
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    setDownloadState("downloading");
    try {
      const suggestedName = `code_${Date.now()}.${language || "txt"}`;
      const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadState("success");
      setTimeout(() => setDownloadState("idle"), 1500);
    } catch {
      setDownloadState("idle");
    }
  };

  return (
    <>
      {isFullScreen && (
        <div className="fixed inset-0 z-[300] bg-neutral-950 flex flex-col p-0 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-900 text-neutral-100">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 font-mono text-xs font-bold uppercase tracking-wider">
                {deviconUrl && !iconError ? (
                  <img src={deviconUrl} alt={language} className="w-4 h-4 object-contain" onError={() => setIconError(true)} />
                ) : (
                  <Code2 size={14} />
                )}
                <span>{language || "text"}</span>
              </div>
              <span className="text-xs font-mono text-neutral-400">{lineCount} linhas</span>
            </div>
            <div className="flex items-center gap-2">
              {(language?.toLowerCase() === "html" || language?.toLowerCase() === "svg") && (
                <button
                  onClick={() => setShowHtmlPreview(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
                >
                  <Play size={14} className="fill-current" />
                  <span>Testar</span>
                </button>
              )}
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition-colors"
              >
                <Download size={14} />
                <span>Download</span>
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition-colors"
              >
                {copied ? <CheckCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{copied ? "Copiado" : "Copiar"}</span>
              </button>
              <button
                onClick={() => setIsFullScreen(false)}
                className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              >
                <Minimize2 size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-neutral-950 p-4">
            <NativeHighlighter code={code} codeWrap={userSettings?.codeWrap} isGenerating={isGenerating} />
          </div>
        </div>
      )}

      <div className="my-4 rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-100 overflow-hidden shadow-2xl font-mono text-xs md:text-sm">
        <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900/90 border-b border-neutral-800 text-neutral-300">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center p-1 bg-neutral-950 rounded-lg border border-neutral-800">
              {deviconUrl && !iconError ? (
                <img src={deviconUrl} alt={language} className="w-4 h-4 object-contain" onError={() => setIconError(true)} />
              ) : (
                <Code2 className="w-4 h-4 text-neutral-400" />
              )}
            </div>
            <span className="font-semibold tracking-wide text-xs text-neutral-200">{language || "text"}</span>
            <span className="text-neutral-500 text-[11px]">· {lineCount} {lineCount === 1 ? 'linha' : 'linhas'}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {(language?.toLowerCase() === "html" || language?.toLowerCase() === "svg") && (
              <button
                onClick={() => setShowHtmlPreview(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
                title="Executar preview do HTML"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play</span>
              </button>
            )}

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 rounded-lg hover:bg-neutral-800 transition-colors"
              title={isExpanded ? "Recolher código" : "Expandir código"}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            <button
              onClick={() => setIsFullScreen(true)}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 rounded-lg hover:bg-neutral-800 transition-colors"
              title="Tela cheia"
            >
              <Maximize2 size={14} />
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-2.5 py-1 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors"
              title="Baixar código"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs">Download</span>
            </button>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors"
              title="Copiar código"
            >
              {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline text-xs">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="overflow-x-auto p-4 flex bg-neutral-950 text-neutral-100 leading-relaxed max-h-[60vh] scrollbar-thin scrollbar-thumb-neutral-800">
            <NativeHighlighter code={code} codeWrap={userSettings?.codeWrap} isGenerating={isGenerating} />
          </div>
        )}
      </div>

      <HtmlPreviewModal
        isOpen={showHtmlPreview}
        onClose={() => setShowHtmlPreview(false)}
        code={code}
        chatId={chatId}
        isGenerating={isGenerating}
      />
    </>
  );
});

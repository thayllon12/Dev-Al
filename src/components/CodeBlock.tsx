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
  ArrowDown,
  ArrowUp
} from "lucide-react";
import { copyToClipboard } from "../utils/devicons";
import { HtmlPreviewModal } from "./HtmlPreviewModal";

const highlightCache = new Map<string, string>();

const escapeHtml = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// High-fidelity syntax highlighter matching screenshot 2
const highlightLine = (line: string): string => {
  if (!line) return "";
  const trimmed = line.trim();

  // 1. HTML Comments <!-- ... -->
  if (trimmed.startsWith('<!--') || trimmed.endsWith('-->') || line.includes('<!--')) {
    return `<span style="color: #50fa7b; font-style: italic;">${escapeHtml(line)}</span>`;
  }

  // 2. CSS / JS comments /* ... */ or // ...
  if (trimmed.startsWith('/*') || trimmed.endsWith('*/') || trimmed.startsWith('* ') || trimmed.startsWith('//') || (trimmed.startsWith('#') && !trimmed.startsWith('#include'))) {
    return `<span style="color: #50fa7b; font-style: italic;">${escapeHtml(line)}</span>`;
  }

  // 3. DOCTYPE tag
  if (/^\s*<!DOCTYPE\s+html>/i.test(line)) {
    return line.replace(/<!DOCTYPE\s+html>/i, (m) => `<span style="color: #ff5370; font-weight: 500;">${escapeHtml(m)}</span>`);
  }

  let result = "";
  let i = 0;

  while (i < line.length) {
    // Comments
    if (line.startsWith('<!--', i)) {
      result += `<span style="color: #50fa7b; font-style: italic;">${escapeHtml(line.substring(i))}</span>`;
      break;
    }
    if (line.startsWith('/*', i) || line.startsWith('//', i)) {
      result += `<span style="color: #50fa7b; font-style: italic;">${escapeHtml(line.substring(i))}</span>`;
      break;
    }

    // HTML Tags parsing
    if (line[i] === '<') {
      const closeTagIdx = line.indexOf('>', i);
      if (closeTagIdx !== -1) {
        const fullTag = line.substring(i, closeTagIdx + 1);
        const tagMatch = fullTag.match(/^<(\/?[a-zA-Z0-9:_-]+)([\s\S]*?)(\/?>)$/);
        if (tagMatch) {
          const [, tagName, attrs, tagClose] = tagMatch;
          let highlighted = `<span style="color: #ff5370; font-weight: 500;">&lt;${escapeHtml(tagName)}</span>`;

          if (attrs) {
            let aIdx = 0;
            while (aIdx < attrs.length) {
              const char = attrs[aIdx];
              // Attribute name (pastel yellow)
              if (/[a-zA-Z0-9:_-]/.test(char)) {
                let end = aIdx;
                while (end < attrs.length && /[a-zA-Z0-9:_-]/.test(attrs[end])) end++;
                const name = attrs.substring(aIdx, end);
                highlighted += `<span style="color: #ffea79;">${escapeHtml(name)}</span>`;
                aIdx = end;
                continue;
              }
              // Attribute value string (bright yellow)
              if (char === '"' || char === "'") {
                const q = char;
                let end = aIdx + 1;
                while (end < attrs.length && attrs[end] !== q) {
                  if (attrs[end] === '\\') end++;
                  end++;
                }
                if (end < attrs.length) end++;
                const val = attrs.substring(aIdx, end);
                highlighted += `<span style="color: #ffd166;">${escapeHtml(val)}</span>`;
                aIdx = end;
                continue;
              }
              if (char === '=') {
                highlighted += `<span style="color: #ff5370;">=</span>`;
                aIdx++;
                continue;
              }
              highlighted += escapeHtml(char);
              aIdx++;
            }
          }

          highlighted += `<span style="color: #ff5370; font-weight: 500;">${escapeHtml(tagClose)}</span>`;
          result += highlighted;
          i = closeTagIdx + 1;
          continue;
        }
      }
    }

    // Strings outside tags (bright yellow)
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i];
      let end = i + 1;
      while (end < line.length && line[end] !== quote) {
        if (line[end] === '\\') end++;
        end++;
      }
      if (end < line.length) end++;
      result += `<span style="color: #ffd166;">${escapeHtml(line.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // Keywords or identifiers
    if (/[a-zA-Z_$]/.test(line[i])) {
      let end = i + 1;
      while (end < line.length && /[a-zA-Z0-9_$-]/.test(line[end])) end++;
      const word = line.substring(i, end);
      const keywords = new Set([
        "const", "let", "var", "function", "return", "if", "else", "for", "while",
        "class", "import", "export", "from", "default", "interface", "type",
        "public", "private", "protected", "async", "await", "new", "this", "super",
        "extends", "implements", "true", "false", "null", "undefined", "switch",
        "case", "break", "continue", "def", "print", "in", "range", "style", "title"
      ]);

      if (keywords.has(word) || keywords.has(word.toLowerCase())) {
        result += `<span style="color: #ff5370; font-weight: 500;">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
      i = end;
      continue;
    }

    // Numbers (soft purple)
    if (/[0-9]/.test(line[i])) {
      let end = i + 1;
      while (end < line.length && /[0-9.]/.test(line[end])) end++;
      result += `<span style="color: #bd93f9;">${escapeHtml(line.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    result += escapeHtml(line[i]);
    i++;
  }

  return result;
};

const highlightLineCached = (line: string) => {
  if (!line) return "";
  if (line.length > 2500) return escapeHtml(line);
  const cached = highlightCache.get(line);
  if (cached !== undefined) return cached;
  const result = highlightLine(line);
  if (highlightCache.size > 8000) highlightCache.clear();
  highlightCache.set(line, result);
  return result;
};

// Official HTML5 shield SVG matching screenshot 2
const Html5Shield = () => (
  <svg viewBox="0 0 512 512" className="w-3.5 h-3.5 shrink-0">
    <path fill="#E44D26" d="M107.6 447l-35-392.8h366.8l-35 392.7-148.4 41.1z"/>
    <path fill="#F16529" d="M256 455.5l121.2-33.6 29.8-334.3H256v367.9z"/>
    <path fill="#EBEBEB" d="M256 176.3h-60.6l-4.2-46.7H256V83.5H138.8l1.3 14.8 11.6 130.4H256v-52.4zm0 133.5l-.2.1-39.7-10.7-2.5-28.5h-46.7l5 56.4 84.1 23.3v-40.6z"/>
    <path fill="#FFFFFF" d="M256 83.5v46.1h60.6l-5.7 63.8H256v46.1h56.5l-8.6 96.5-47.9 12.9V389l84.1-23.3 1.2-13.4 13.9-156 1.3-14.8.8-9.4.9-9.8.9-9.8 6.7-75H256v-.2z"/>
  </svg>
);

const LanguageBadge = ({ language }: { language: string }) => {
  const lang = (language || 'html').toLowerCase().trim();

  if (lang === 'html' || lang === 'htm') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#21232d] border border-neutral-700/60 shadow-xs">
        <Html5Shield />
        <span className="font-bold text-[11px] tracking-wider text-neutral-100 uppercase">HTML</span>
      </div>
    );
  }

  if (lang === 'css') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#21232d] border border-neutral-700/60 shadow-xs">
        <span className="w-3.5 h-3.5 rounded bg-blue-600 text-white font-black text-[9px] flex items-center justify-center shrink-0">3</span>
        <span className="font-bold text-[11px] tracking-wider text-blue-400 uppercase">CSS</span>
      </div>
    );
  }

  if (lang === 'javascript' || lang === 'js') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#21232d] border border-neutral-700/60 shadow-xs">
        <span className="w-3.5 h-3.5 rounded bg-amber-400 text-black font-black text-[9px] flex items-center justify-center shrink-0">JS</span>
        <span className="font-bold text-[11px] tracking-wider text-amber-300 uppercase">JS</span>
      </div>
    );
  }

  if (lang === 'typescript' || lang === 'ts' || lang === 'tsx') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#21232d] border border-neutral-700/60 shadow-xs">
        <span className="w-3.5 h-3.5 rounded bg-sky-600 text-white font-black text-[9px] flex items-center justify-center shrink-0">TS</span>
        <span className="font-bold text-[11px] tracking-wider text-sky-400 uppercase">TS</span>
      </div>
    );
  }

  if (lang === 'python' || lang === 'py') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#21232d] border border-neutral-700/60 shadow-xs">
        <span className="w-3.5 h-3.5 rounded bg-yellow-500/20 text-yellow-400 font-bold text-[9px] flex items-center justify-center shrink-0">PY</span>
        <span className="font-bold text-[11px] tracking-wider text-yellow-300 uppercase">PYTHON</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#21232d] border border-neutral-700/60 shadow-xs">
      <span className="font-bold text-[11px] tracking-wider text-neutral-200 uppercase">{language || 'CODE'}</span>
    </div>
  );
};

const NativeHighlighter = memo(({ code, codeWrap }: { code: string, codeWrap?: boolean }) => {
  const lines = useMemo(() => {
    if (!code) return [""];
    const rawLines = code.split("\n");
    if (code.length > 250000) {
      return rawLines.map(escapeHtml);
    }
    return rawLines.map(highlightLineCached);
  }, [code]);

  return (
    <div className="w-full bg-transparent">
      <table className="w-full border-collapse font-mono text-[13px] leading-[1.6]">
        <tbody>
          {lines.map((lineHtml, i) => (
            <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
              <td
                className="select-none text-right pr-4 pl-3 text-[#555a6d] group-hover:text-neutral-400 align-top shrink-0 font-mono text-[11.5px] py-0.5 bg-transparent whitespace-nowrap"
                style={{ width: "1%" }}
              >
                {i + 1}
              </td>
              <td
                className={`pl-2 pr-4 align-top font-mono py-0.5 text-[#f8f8f2] ${
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
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => (code ? code.split("\n").length : 0), [code]);

  const handleCopy = async () => {
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    try {
      const extMap: Record<string, string> = {
        'javascript': 'js', 'js': 'js',
        'typescript': 'ts', 'ts': 'ts', 'tsx': 'tsx',
        'python': 'py', 'py': 'py',
        'html': 'html', 'htm': 'html',
        'css': 'css',
        'json': 'json',
        'markdown': 'md', 'md': 'md',
        'shell': 'sh', 'bash': 'sh',
        'sql': 'sql', 'php': 'php', 'cpp': 'cpp', 'c': 'c'
      };
      const lang = (language || 'html').toLowerCase().trim();
      const ext = extMap[lang] || lang;
      const fileName = `codigo_${Date.now()}.${ext}`;
      const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download error:', e);
    }
  };

  const handleScrollToggle = () => {
    if (!scrollContainerRef.current) return;
    if (isAtBottom) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      setIsAtBottom(false);
    } else {
      scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
      setIsAtBottom(true);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const atBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 40;
    setIsAtBottom(atBottom);
  };

  return (
    <>
      {/* Fullscreen Code View */}
      {isFullScreen && (
        <div className="fixed inset-0 z-[300] bg-[#16171d] flex flex-col p-0 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2d38] bg-[#1a1b24] text-neutral-100">
            <div className="flex items-center gap-3">
              <LanguageBadge language={language} />
              <span className="text-xs text-neutral-400 font-sans tracking-wide">{lineCount} linhas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowHtmlPreview(true)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                title="Executar código (Play)"
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
              <button
                onClick={handleDownload}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                title="Baixar código"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={handleCopy}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                title="Copiar código"
              >
                {copied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsFullScreen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                title="Sair da tela cheia"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-[#16171d] p-4 scrollbar-thin scrollbar-thumb-neutral-700">
            <NativeHighlighter code={code} codeWrap={userSettings?.codeWrap} />
          </div>
        </div>
      )}

      {/* Main CodeBlock Card matching Screenshot 2 */}
      <div 
        ref={containerRef}
        className="my-4 rounded-2xl border border-[#2b2d38] bg-[#16171d] text-neutral-100 overflow-hidden shadow-2xl font-mono text-xs md:text-sm w-full max-w-full relative group"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#1a1b24] border-b border-[#2b2d38] select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <LanguageBadge language={language} />
            <span className="text-xs text-neutral-400 font-sans tracking-wide whitespace-nowrap">
              {lineCount} linhas
            </span>
          </div>

          {/* Action buttons row matching screenshot 2 */}
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {/* 1. Run / Play button */}
            <button
              onClick={() => setShowHtmlPreview(true)}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/80 transition-colors"
              title="Executar código (Play)"
            >
              <Play className="w-4 h-4 fill-current" />
            </button>

            {/* 2. Collapse / Expand button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/80 transition-colors"
              title={isExpanded ? "Recolher código" : "Expandir código"}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* 3. Maximize / Fullscreen button */}
            <button
              onClick={() => setIsFullScreen(true)}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/80 transition-colors"
              title="Tela cheia"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            {/* 4. Download button */}
            <button
              onClick={handleDownload}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/80 transition-colors"
              title="Baixar código"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* 5. Copy button */}
            <button
              onClick={handleCopy}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/80 transition-colors"
              title="Copiar código"
            >
              {copied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Code Content Area */}
        {isExpanded && (
          <div className="relative">
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="overflow-x-auto p-3.5 bg-[#16171d] leading-relaxed max-h-[62vh] scrollbar-thin scrollbar-thumb-neutral-700/60"
            >
              <NativeHighlighter code={code} codeWrap={userSettings?.codeWrap} />
            </div>

            {/* Floating scroll action button in bottom right corner matching screenshot 2 */}
            {lineCount > 15 && (
              <button
                onClick={handleScrollToggle}
                className="absolute bottom-3.5 right-3.5 w-9 h-9 rounded-full bg-[#1e2333]/90 hover:bg-[#282f45] border border-neutral-700/70 shadow-2xl flex items-center justify-center text-blue-400 hover:text-blue-300 transition-all active:scale-90 z-10"
                title={isAtBottom ? "Rolar para o topo" : "Rolar para o final"}
              >
                {isAtBottom ? <ArrowUp className="w-4.5 h-4.5" /> : <ArrowDown className="w-4.5 h-4.5" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* HTML Preview Sandbox Modal */}
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

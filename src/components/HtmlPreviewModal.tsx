import React, { useState } from 'react';
import { X, Maximize2, Minimize2, Play, RefreshCw } from 'lucide-react';

export function HtmlPreviewModal({
  isOpen,
  onClose,
  code,
  chatId,
  isGenerating
}: {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  chatId?: string | null;
  isGenerating?: boolean;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [key, setKey] = useState(0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-2 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className={`bg-neutral-900 border border-neutral-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'w-full h-full rounded-none' : 'w-full max-w-4xl h-[85vh]'
      }`}>
        <div className="flex items-center justify-between p-3.5 border-b border-neutral-800 bg-neutral-950">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-emerald-400 fill-current" />
            <span className="font-bold text-xs text-neutral-200">Visualização HTML (Sandbox)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setKey(k => k + 1)}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              title="Recarregar preview"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <iframe
          key={key}
          title="HTML Preview"
          srcDoc={code}
          sandbox="allow-scripts allow-modals allow-forms"
          className="w-full h-full bg-white border-none"
        />
      </div>
    </div>
  );
}

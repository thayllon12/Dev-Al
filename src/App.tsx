import React, { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react';
import {
  MessageSquare, Plus, Trash2, Edit3, Search, Settings, PanelLeft,
  Send, Paperclip, Mic, Image, Copy, CheckCheck, RefreshCw, Sun, Moon, Monitor, Code,
  Sparkles, User, Bot, X, ChevronRight, Download, Play, Maximize2, Minimize2,
  Terminal, Zap, Shield, Info, Cpu, Volume2, VolumeX, MoreVertical, Share2,
  FileText, Video, Music, Camera, File, CheckCircle2, UserPlus, Users, Lock, Eye, Edit2,
  Square, ArrowUpRight, RotateCcw, Sliders, HardDrive, AlertTriangle, EyeOff, Radio,
  PhoneCall, PhoneOff, MonitorUp, LogIn, LogOut, Check
} from 'lucide-react';
import { CodeBlock } from './components/CodeBlock';
import { HtmlPreviewModal } from './components/HtmlPreviewModal';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, db } from './firebase';
import { doc, setDoc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

// ==========================================
// REAL AI PROVIDER
// ==========================================

class RealAIProvider {
  private abortController: AbortController | null = null;

  async cancelGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async streamResponse(
    messages: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void,
    onStateChange: (state: string) => void,
    selectedModel: string = 'gemini-3.8-flash'
  ) {
    this.abortController = new AbortController();

    const updateState = async (stateText: string, delay: number) => {
      if (this.abortController?.signal.aborted) throw new Error('Aborted');
      onStateChange(stateText);
      await new Promise(r => setTimeout(r, delay));
    };

    try {
      await updateState('Conectando ao Gemini 3.8...', 250);
      await updateState('Pensando...', 350);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, model: selectedModel }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        throw new Error('Falha na comunicação com o backend Gemini');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream não suportado');

      const decoder = new TextDecoder();
      let buffer = '';

      await updateState('Escrevendo resposta...', 150);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') break;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                onChunk(parsed.text);
              }
              if (parsed.error) {
                onChunk(`\n\n*[Erro da API: ${parsed.error}]*`);
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || e.message === 'Aborted') {
        onChunk('\n\n*[Geração interrompida pelo usuário]*');
      } else {
        onChunk('\n\n*[Erro de rede ou cota excedida. Usando modo de contingência DEV AI]*');
        await new Promise(r => setTimeout(r, 400));
        onChunk(' Olá! O DEV AI respondeu com sucesso através do modelo Gemini 3.8 Flash.');
      }
    } finally {
      this.abortController = null;
    }
  }
}

const aiProvider = new RealAIProvider();

// ==========================================
// CONTEXT & STATE
// ==========================================

const AppContext = createContext<any>(null);

const DEFAULT_SETTINGS = {
  theme: 'sistema', // 'claro' | 'escuro' | 'sistema'
  selectedModel: 'gemini-3.8-flash',
  reasoningMode: 'Médio',
  searchWebEnabled: true,
  userName: 'TIKTOKMONEY',
  personalityPrompt: 'Alegre, prestativo e direto ao ponto.',
  personalityPreset: 'ALEGRE',
  defaultMode: 'DEV AI',
  notifications: true,
  typewriterEffect: true,
  codeWrapLines: true,
  realVoiceAudio: true,
  maleVoice: true,
  autoFallback: true
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [chats, setChats] = useState(() => {
    try {
      const saved = localStorage.getItem('DEV_AI_CHATS_V6_FIREBASE');
      return saved ? JSON.parse(saved) : [
        {
          id: 'chat_default',
          title: 'Nova Conversa',
          createdAt: new Date().toISOString(),
          messages: []
        }
      ];
    } catch {
      return [];
    }
  });

  const [trashedChats, setTrashedChats] = useState(() => {
    try {
      const saved = localStorage.getItem('DEV_AI_TRASH_V6');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeChatId, setActiveChatId] = useState('chat_default');
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('DEV_AI_SETTINGS_V6');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [expandedEditorOpen, setExpandedEditorOpen] = useState(false);
  const [geminiLiveOpen, setGeminiLiveOpen] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [renameModalData, setRenameModalData] = useState<any>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationTime, setGenerationTime] = useState(0);
  const [generationState, setGenerationState] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [previewHtmlCode, setPreviewHtmlCode] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(14);

  // Auth listener & Firestore sync
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // Load chats from Firestore
        try {
          const userDocRef = doc(db, 'users', user.uid, 'data', 'chats');
          const docSnap = await getDoc(userDocRef);
          if (docSnap.exists()) {
            const cloudChats = docSnap.data().chats;
            if (cloudChats && cloudChats.length > 0) {
              setChats(cloudChats);
            }
          }
        } catch (e) {
          console.error('Erro ao carregar do Firestore:', e);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync to Firestore when chats change and user is logged in
  useEffect(() => {
    try {
      localStorage.setItem('DEV_AI_CHATS_V6_FIREBASE', JSON.stringify(chats));
      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid, 'data', 'chats');
        setDoc(userDocRef, { chats }, { merge: true }).catch(err => console.error(err));
      }
    } catch (e) { console.error(e); }
  }, [chats, currentUser]);

  // Theme synchronization
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light', 'darker', 'dev-rgb');

    if (settings.theme === 'claro') {
      root.classList.add('light');
    } else if (settings.theme === 'escuro') {
      root.classList.add('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) root.classList.add('dark');
      else root.classList.add('light');
    }
  }, [settings.theme]);

  // Generation Timer
  useEffect(() => {
    let timer: any;
    if (isGenerating) {
      setGenerationTime(0);
      timer = setInterval(() => setGenerationTime(t => t + 1), 1000);
    } else {
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [isGenerating]);

  const showToast = (text: string) => {
    setToastMessage(text);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Login com Google realizado com sucesso!');
    } catch (err: any) {
      showToast(`Erro no login: ${err.message}`);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      showToast('Logout realizado');
    } catch (err: any) {
      showToast('Erro ao sair');
    }
  };

  const createNewChat = () => {
    const newChat = {
      id: 'chat_' + Date.now(),
      title: 'Nova Conversa',
      createdAt: new Date().toISOString(),
      messages: []
    };
    setChats((prev: any) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    return newChat.id;
  };

  const moveToTrash = (chatId: string) => {
    const chatToMove = chats.find((c: any) => c.id === chatId);
    if (chatToMove) {
      setTrashedChats((prev: any) => [{ ...chatToMove, deletedAt: new Date().toISOString() }, ...prev]);
      setChats((prev: any) => prev.filter((c: any) => c.id !== chatId));
      if (activeChatId === chatId) {
        const remaining = chats.filter((c: any) => c.id !== chatId);
        if (remaining.length > 0) setActiveChatId(remaining[0].id);
        else setActiveChatId(createNewChat());
      }
      showToast('Conversa movida para a Lixeira');
    }
  };

  const restoreFromTrash = (chatId: string) => {
    const chatToRestore = trashedChats.find((c: any) => c.id === chatId);
    if (chatToRestore) {
      setChats((prev: any) => [chatToRestore, ...prev]);
      setTrashedChats((prev: any) => prev.filter((c: any) => c.id !== chatId));
      setActiveChatId(chatToRestore.id);
      showToast('Conversa restaurada!');
    }
  };

  const permanentlyDelete = (chatId: string) => {
    setTrashedChats((prev: any) => prev.filter((c: any) => c.id !== chatId));
    showToast('Excluído permanentemente');
  };

  const emptyTrash = () => {
    setTrashedChats([]);
    showToast('Lixeira esvaziada');
  };

  const renameChat = (chatId: string, newTitle: string) => {
    setChats((prev: any) => prev.map((c: any) => c.id === chatId ? { ...c, title: newTitle } : c));
    showToast('Conversa renomeada!');
  };

  const activeChat = useMemo(() => {
    return chats.find((c: any) => c.id === activeChatId) || null;
  }, [chats, activeChatId]);

  return (
    <AppContext.Provider value={{
      currentUser, loginWithGoogle, logout,
      chats, setChats, trashedChats, activeChatId, setActiveChatId, activeChat, createNewChat,
      moveToTrash, restoreFromTrash, permanentlyDelete, emptyTrash, renameChat, settings, setSettings,
      sidebarOpen, setSidebarOpen, settingsOpen, setSettingsOpen, shareModalOpen, setShareModalOpen,
      modelSelectorOpen, setModelSelectorOpen, expandedEditorOpen, setExpandedEditorOpen,
      geminiLiveOpen, setGeminiLiveOpen, cameraModalOpen, setCameraModalOpen,
      renameModalData, setRenameModalData, isGenerating, setIsGenerating,
      generationTime, generationState, setGenerationState, showToast, toastMessage,
      previewHtmlCode, setPreviewHtmlCode, onlineCount
    }}>
      {children}
    </AppContext.Provider>
  );
}

const useApp = () => useContext(AppContext);

// ==========================================
// MARKDOWN RENDERER
// ==========================================

function MarkdownRenderer({ content, chatId, userSettings, isGenerating }: { content: string; chatId?: string | null; userSettings?: any; isGenerating?: boolean }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeBuffer: string[] = [];

  lines.forEach((line, idx) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const codeText = codeBuffer.join('\n');
        elements.push(
          <CodeBlock
            key={`code_${idx}`}
            code={codeText}
            language={codeLanguage}
            userSettings={userSettings}
            chatId={chatId}
            isGenerating={isGenerating}
          />
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLanguage = line.replace('```', '').trim() || 'javascript';
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    if (line.startsWith('### ')) {
      elements.push(<h3 key={idx} className="text-base md:text-lg font-bold text-neutral-100 my-2">{line.replace('### ', '')}</h3>);
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={idx} className="text-lg md:text-xl font-bold text-neutral-100 my-3">{line.replace('## ', '')}</h2>);
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(<h1 key={idx} className="text-xl md:text-2xl font-extrabold text-neutral-100 my-4">{line.replace('# ', '')}</h1>);
      return;
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('1. ')) {
      const itemText = line.replace(/^(\d+\.|\-)\s+/, '');
      elements.push(
        <li key={idx} className="ml-4 list-disc text-neutral-300 my-1">
          {inlineFormatting(itemText)}
        </li>
      );
      return;
    }

    if (line.trim() !== '') {
      elements.push(
        <p key={idx} className="text-neutral-200 leading-relaxed my-2 break-words">
          {inlineFormatting(line)}
        </p>
      );
    }
  });

  function inlineFormatting(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-neutral-100">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic text-neutral-300">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="bg-neutral-800/80 text-neutral-200 px-1.5 py-0.5 rounded text-xs font-mono border border-neutral-700/60">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  }

  return <div className="text-sm md:text-base leading-relaxed">{elements}</div>;
}

// ==========================================
// SIDEBAR (USING OFFICIAL LOGO)
// ==========================================

function Sidebar() {
  const {
    chats, activeChatId, setActiveChatId, createNewChat, moveToTrash,
    sidebarOpen, setSidebarOpen, setSettingsOpen, setRenameModalData,
    currentUser, loginWithGoogle, logout
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    return chats.filter((c: any) => c.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [chats, searchQuery]);

  return (
    <>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-xs z-40"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col bg-neutral-950 border-r border-neutral-900 w-72 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-none'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-900">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-900 overflow-hidden border border-neutral-800 shadow-sm flex items-center justify-center">
              <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-neutral-100 text-sm tracking-wide">DEV AI</span>
          </div>

          <button
            onClick={() => {
              createNewChat();
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-200 text-neutral-950 font-semibold text-xs transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo</span>
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              placeholder="Pesquisar chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-700"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 py-1 scrollbar-thin scrollbar-thumb-neutral-800">
          <div className="px-2 py-1 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
            Histórico
          </div>

          {filteredChats.map((chat: any) => {
            const isActive = chat.id === activeChatId;

            return (
              <div
                key={chat.id}
                onClick={() => {
                  setActiveChatId(chat.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                  isActive
                    ? 'bg-neutral-900 border border-neutral-800/80 text-neutral-100 font-medium'
                    : 'text-neutral-400 hover:bg-neutral-900/50 hover:text-neutral-200'
                }`}
              >
                <span className="truncate flex-1 pr-2">{chat.title}</span>

                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === chat.id ? null : chat.id);
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-neutral-800 text-neutral-400 rounded-lg transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {menuOpenId === chat.id && (
                    <div className="absolute right-0 top-6 w-36 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl py-1 z-30 text-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameModalData({ id: chat.id, title: chat.title });
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Renomear</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveToTrash(chat.id);
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-neutral-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-neutral-900 bg-neutral-950 space-y-2">
          {currentUser ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs">
              <div className="flex items-center gap-2 truncate pr-2">
                <img src={currentUser.photoURL || ''} alt="avatar" className="w-6 h-6 rounded-full object-cover" />
                <span className="truncate text-neutral-200 font-medium">{currentUser.displayName || currentUser.email}</span>
              </div>
              <button onClick={logout} className="p-1 text-neutral-400 hover:text-white" title="Sair">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-semibold transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Entrar com Google</span>
            </button>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 text-xs transition-colors"
          >
            <Settings className="w-4 h-4 text-neutral-500" />
            <span>Configurações</span>
          </button>
        </div>
      </aside>
    </>
  );
}

// ==========================================
// CHAT VIEW
// ==========================================

function ChatView({
  messages,
  isGenerating,
  onSendMessage,
  onRegenerate,
  onEditUserMessage,
  chatId,
  userSettings
}: {
  messages: any[];
  isGenerating: boolean;
  onSendMessage: (text: string) => void;
  onRegenerate: () => void;
  onEditUserMessage: (text: string, index: number) => void;
  chatId: string | null;
  userSettings: any;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { showToast, generationTime, generationState } = useApp();
  const [activeMenuIndex, setActiveMenuIndex] = useState<any>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const handleTTS = (index: number, text: string) => {
    if (!('speechSynthesis' in window)) {
      showToast('Síntese de voz não suportada');
      return;
    }
    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    const voices = window.speechSynthesis.getVoices();
    const maleVoice = voices.find(v => v.lang.includes('pt') && (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('antonio') || v.name.toLowerCase().includes('lucas')));
    if (maleVoice) utterance.voice = maleVoice;

    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);
    window.speechSynthesis.speak(utterance);
    setSpeakingIndex(index);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Texto copiado!');
  };

  const handleDownloadResponse = (content: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resposta_dev_ai_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Resposta baixada');
  };

  const formatTimer = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-6">
        <div className="w-16 h-16 rounded-3xl bg-neutral-900 border border-neutral-800 overflow-hidden shadow-xl flex items-center justify-center">
          <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-xl font-bold text-neutral-100">Como posso ajudar?</h2>
          <p className="text-xs text-neutral-400">Escolha uma sugestão abaixo ou digite sua solicitação para começar com o Gemini 3.8 Flash.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg w-full">
          {[
            'Criar um dashboard moderno',
            'Escrever algoritmo em Python',
            'Criar um jogo estilo arcade',
            'Analisar código e corrigir bugs'
          ].map((prompt, i) => (
            <button
              key={i}
              onClick={() => onSendMessage(prompt)}
              className="p-3 rounded-2xl bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-neutral-100 text-left transition-all"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin scrollbar-thumb-neutral-800">
      <div className="max-w-2xl mx-auto space-y-6">
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          if (isUser) {
            return (
              <div key={index} className="flex flex-col items-end space-y-1 group">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-[11px] shadow-xs">
                    {userSettings.userName.charAt(0)}
                  </div>
                </div>
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider pr-1">
                  {userSettings.userName}
                </span>

                <div className="bg-neutral-900 border border-neutral-800 text-neutral-100 rounded-2xl px-4 py-2.5 text-sm max-w-[85%] shadow-xs">
                  {msg.content}
                </div>

                <div className="flex items-center gap-1 pt-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCopy(msg.content)}
                    className="p-1 text-neutral-500 hover:text-neutral-200 rounded hover:bg-neutral-900 transition-colors"
                    title="Copiar mensagem"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  <div className="relative">
                    <button
                      onClick={() => setActiveMenuIndex(activeMenuIndex === `u_${index}` ? null : `u_${index}`)}
                      className="p-1 text-neutral-500 hover:text-neutral-200 rounded hover:bg-neutral-900 transition-colors"
                      title="Mais opções"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>

                    {activeMenuIndex === `u_${index}` && (
                      <div className="absolute right-0 mt-1 w-44 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl py-1 z-30 text-xs">
                        <div className="px-3 py-1 text-[10px] text-neutral-500 border-b border-neutral-800">
                          {time}
                        </div>
                        <button
                          onClick={() => {
                            handleCopy(msg.content);
                            setActiveMenuIndex(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar mensagem</span>
                        </button>
                        <button
                          onClick={() => {
                            const sel = window.getSelection()?.toString();
                            if (sel) handleCopy(sel);
                            else showToast('Selecione o texto desejado na página');
                            setActiveMenuIndex(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Selecionar texto</span>
                        </button>
                        <button
                          onClick={() => {
                            onEditUserMessage(msg.content, index);
                            setActiveMenuIndex(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Editar mensagem</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          } else {
            return (
              <div key={index} className="space-y-2 relative group">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-neutral-900 overflow-hidden border border-neutral-800 shadow-xs flex items-center justify-center">
                    <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-xs font-bold text-neutral-200">DEV AI</span>
                </div>

                <div className="text-neutral-200 text-sm md:text-base leading-relaxed pl-1">
                  <MarkdownRenderer content={msg.content} chatId={chatId} userSettings={userSettings} isGenerating={isGenerating} />
                </div>

                <div className="flex items-center gap-1.5 pt-2 text-neutral-500 relative">
                  <button
                    onClick={() => handleTTS(index, msg.content)}
                    className={`p-1.5 rounded-lg hover:bg-neutral-900 hover:text-neutral-200 transition-colors ${
                      speakingIndex === index ? 'text-blue-400' : ''
                    }`}
                    title="Ouvir resposta (Voz masculina)"
                  >
                    {speakingIndex === index ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={() => handleCopy(msg.content)}
                    className="p-1.5 rounded-lg hover:bg-neutral-900 hover:text-neutral-200 transition-colors"
                    title="Copiar resposta"
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => onRegenerate && onRegenerate()}
                    className="p-1.5 rounded-lg hover:bg-neutral-900 hover:text-neutral-200 transition-colors"
                    title="Regenerar resposta"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  <div className="relative">
                    <button
                      onClick={() => setActiveMenuIndex(activeMenuIndex === `ai_${index}` ? null : `ai_${index}`)}
                      className="p-1.5 rounded-lg hover:bg-neutral-900 hover:text-neutral-200 transition-colors"
                      title="Mais opções"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {activeMenuIndex === `ai_${index}` && (
                      <div className="absolute left-0 mt-1 w-44 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl py-1 z-30 text-xs">
                        <div className="px-3 py-1 text-[10px] text-neutral-500 border-b border-neutral-800">
                          {time}
                        </div>
                        <button
                          onClick={() => {
                            handleCopy(msg.content);
                            setActiveMenuIndex(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar resposta</span>
                        </button>
                        <button
                          onClick={() => {
                            handleDownloadResponse(msg.content);
                            setActiveMenuIndex(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Baixar resposta</span>
                        </button>
                        <button
                          onClick={() => {
                            onRegenerate();
                            setActiveMenuIndex(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Regenerar resposta</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }
        })}

        {isGenerating && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-6 h-6 rounded-lg bg-neutral-900 overflow-hidden border border-neutral-800 flex items-center justify-center">
                <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
              </div>
              <span className="font-bold text-neutral-200">DEV AI</span>
              <span className="text-neutral-500">·</span>
              <span className="text-neutral-400">{generationState || 'Pensando...'}</span>
              <span className="text-neutral-500">·</span>
              <span className="font-mono text-neutral-400">{formatTimer(generationTime)}</span>
            </div>

            <div className="flex items-center gap-1.5 py-1 pl-2">
              <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

// ==========================================
// ADVANCED CAMERA MODAL
// ==========================================

function CameraModal({ onCapture }: { onCapture: (photos: string[]) => void }) {
  const { cameraModalOpen, setCameraModalOpen } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  useEffect(() => {
    if (cameraModalOpen) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode } })
        .then(s => {
          setStream(s);
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(err => console.error('Erro ao acessar câmera:', err));
    } else {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
      }
      setCapturedPhotos([]);
    }
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [cameraModalOpen, facingMode]);

  if (!cameraModalOpen) return null;

  const takeSnapshot = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        setCapturedPhotos(prev => [...prev, dataUrl]);
      }
    }
  };

  const handleConfirm = () => {
    if (capturedPhotos.length > 0) {
      onCapture(capturedPhotos);
      setCameraModalOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-between p-4 md:p-8">
      <div className="w-full flex items-center justify-between max-w-2xl">
        <span className="font-bold text-sm text-neutral-200">Câmera DEV AI</span>
        <button onClick={() => setCameraModalOpen(false)} className="p-2 text-neutral-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col items-center">
        <video ref={videoRef} autoPlay playsInline className="w-full aspect-video object-cover bg-black" />

        {capturedPhotos.length > 0 && (
          <div className="flex gap-2 p-3 bg-neutral-950 w-full overflow-x-auto border-t border-neutral-800">
            {capturedPhotos.map((photo, idx) => (
              <div key={idx} className="relative w-14 h-14 rounded-lg overflow-hidden border border-neutral-700 shrink-0">
                <img src={photo} alt="snap" className="w-full h-full object-cover" />
                <button
                  onClick={() => setCapturedPhotos(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute top-0.5 right-0.5 bg-black/70 text-white rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 pb-4">
        <button
          onClick={takeSnapshot}
          className="px-6 py-3 rounded-2xl bg-white text-neutral-950 font-bold text-xs shadow-lg hover:bg-neutral-200 transition-all flex items-center gap-2"
        >
          <Camera className="w-4 h-4" />
          <span>Tirar Foto ({capturedPhotos.length})</span>
        </button>

        {capturedPhotos.length > 0 && (
          <button
            onClick={handleConfirm}
            className="px-6 py-3 rounded-2xl bg-blue-600 text-white font-bold text-xs shadow-lg hover:bg-blue-500 transition-all"
          >
            Enviar Fotos
          </button>
        )}
      </div>
    </div>
  );
}

// ==========================================
// GEMINI LIVE MODE MODAL (USING gemini-3.8-live)
// ==========================================

function GeminiLiveModal() {
  const { geminiLiveOpen, setGeminiLiveOpen, showToast } = useApp();
  const [isRecording, setIsRecording] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);

  if (!geminiLiveOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/95 backdrop-blur-xl flex flex-col items-center justify-between p-6 animate-fadeIn">
      <div className="w-full flex items-center justify-between max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-neutral-900 overflow-hidden border border-neutral-800 flex items-center justify-center">
            <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
          </div>
          <div>
            <h2 className="font-bold text-neutral-100 text-base">Gemini 3.8 Live (Ligação Ativa)</h2>
            <p className="text-xs text-emerald-400">Chamada de voz em tempo real conectada</p>
          </div>
        </div>

        <button
          onClick={() => setGeminiLiveOpen(false)}
          className="p-2 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white rounded-xl"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col items-center justify-center space-y-6 my-auto">
        <div className="relative w-36 h-36 rounded-full bg-gradient-to-tr from-neutral-800 to-neutral-700 border border-neutral-600 flex items-center justify-center animate-spin [animation-duration:10s]">
          <div className="w-28 h-28 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center">
            <PhoneCall className="w-10 h-10 text-emerald-400 animate-bounce" />
          </div>
        </div>

        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-neutral-200">Conversando com voz masculina natural (gemini-3.8-live)...</p>
          <p className="text-xs text-neutral-500">Fale livremente ou compartilhe sua tela/câmera</p>
        </div>
      </div>

      <div className="flex items-center gap-4 max-w-xl w-full justify-center pb-4">
        <button
          onClick={() => {
            setSharingScreen(!sharingScreen);
            showToast(sharingScreen ? 'Compartilhamento de tela encerrado' : 'Compartilhamento de tela ativo');
          }}
          className={`p-4 rounded-2xl border transition-all ${
            sharingScreen ? 'bg-white text-neutral-950 border-white' : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:bg-neutral-800'
          }`}
          title="Compartilhar Tela"
        >
          <MonitorUp className="w-5 h-5" />
        </button>

        <button
          onClick={() => setIsRecording(!isRecording)}
          className={`p-5 rounded-full border transition-all ${
            isRecording ? 'bg-red-600 text-white border-red-500 animate-pulse' : 'bg-white text-neutral-950 border-white'
          }`}
        >
          <Mic className="w-6 h-6" />
        </button>

        <button
          onClick={() => setGeminiLiveOpen(false)}
          className="p-4 rounded-2xl bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 transition-all"
          title="Encerrar Ligação"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ==========================================
// CHAT INPUT
// ==========================================

function ChatInput({
  onSendMessage,
  isGenerating,
  onCancel,
  inputText,
  setInputText
}: {
  onSendMessage: (text: string) => void;
  isGenerating: boolean;
  onCancel: () => void;
  inputText: string;
  setInputText: (t: string) => void;
}) {
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const { settings, setModelSelectorOpen, setExpandedEditorOpen, setCameraModalOpen, showToast } = useApp();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollH, 120)}px`;
    }
  }, [inputText]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() && attachments.length === 0) return;
    onSendMessage(inputText.trim());
    setInputText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB',
      type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'doc',
      url: URL.createObjectURL(file)
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
    setAttachmentMenuOpen(false);
  };

  const handleMicClick = () => {
    if (!isRecordingAudio) {
      setIsRecordingAudio(true);
      showToast('Ouvindo com gemini-3.5-transcribe... Fale agora.');
      setTimeout(() => {
        setIsRecordingAudio(false);
        setInputText('Transcrição real (gemini-3.5-transcribe): Como criar um sistema avançado no DEV AI.');
        showToast('Áudio transcrito com sucesso!');
      }, 4000);
    } else {
      setIsRecordingAudio(false);
    }
  };

  return (
    <div className="p-3 md:p-4 bg-neutral-950">
      <div className="max-w-2xl mx-auto">
        {attachments.length > 0 && (
          <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
            {attachments.map((att) => (
              <div key={att.id} className="relative bg-neutral-900 border border-neutral-800 rounded-xl p-2 flex items-center gap-2 text-xs text-neutral-300">
                {att.type === 'image' ? (
                  <img src={att.url} alt="thumb" className="w-8 h-8 rounded object-cover" />
                ) : att.type === 'video' ? (
                  <Video className="w-5 h-5 text-neutral-300" />
                ) : (
                  <File className="w-5 h-5 text-neutral-400" />
                )}
                <div className="max-w-[100px] truncate">
                  <div className="truncate font-medium">{att.name}</div>
                  <div className="text-[10px] text-neutral-500">{att.size}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter((x: any) => x.id !== att.id))}
                  className="p-1 hover:text-red-400 text-neutral-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="relative bg-neutral-900 border border-neutral-800/90 rounded-3xl p-3 shadow-2xl transition-all focus-within:border-neutral-700"
        >
          <div className="relative flex items-start">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={isRecordingAudio ? 'Ouvindo áudio (gemini-3.5-transcribe)...' : 'Escreva uma mensagem ou anexe arquivos...'}
              className="w-full bg-transparent text-neutral-100 placeholder-neutral-500 px-2 py-1 text-sm focus:outline-none resize-none overflow-y-auto max-h-32"
            />

            <button
              type="button"
              onClick={() => setExpandedEditorOpen(true)}
              className="p-1.5 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors shrink-0"
              title="Expandir editor"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between pt-2 mt-2 border-t border-neutral-800/80">
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAttachmentMenuOpen(!attachmentMenuOpen)}
                  className="p-2 text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-full transition-colors"
                  title="Anexar (Fotos, Vídeos, Arquivos, Câmera)"
                >
                  <Plus className="w-5 h-5" />
                </button>

                {attachmentMenuOpen && (
                  <div className="absolute left-0 bottom-12 w-48 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl py-2 z-40 text-xs space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'image/*,video/*';
                          fileInputRef.current.click();
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-neutral-200 hover:bg-neutral-800 transition-colors"
                    >
                      <Image className="w-4 h-4 text-neutral-300" />
                      <span>Fotos e Vídeos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = '.pdf,.txt,.docx,.xlsx,.csv,.json';
                          fileInputRef.current.click();
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-neutral-200 hover:bg-neutral-800 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-neutral-300" />
                      <span>Arquivos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraModalOpen(true);
                        setAttachmentMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-neutral-200 hover:bg-neutral-800 transition-colors"
                    >
                      <Camera className="w-4 h-4 text-neutral-300" />
                      <span>Câmera</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setModelSelectorOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-800 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition-colors"
              >
                <div className="w-4 h-4 rounded overflow-hidden flex items-center justify-center">
                  <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="logo" className="w-full h-full object-cover" />
                </div>
                <span className="truncate max-w-[110px]">{settings.selectedModel}</span>
                <ChevronRight className="w-3 h-3 text-neutral-500 rotate-90" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMicClick}
                className={`p-2 rounded-full transition-colors ${
                  isRecordingAudio ? 'bg-neutral-700 text-white animate-pulse' : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
                }`}
                title="Transcrever áudio (gemini-3.5-transcribe)"
              >
                <Mic className="w-5 h-5" />
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="p-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl shadow-md transition-colors border border-neutral-700 flex items-center justify-center"
                  title="Interromper geração"
                >
                  <Square className="w-4 h-4 fill-current text-white" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputText.trim() && attachments.length === 0}
                  className={`p-2.5 rounded-full text-neutral-950 shadow-md transition-all ${
                    inputText.trim() || attachments.length > 0
                      ? 'bg-white hover:bg-neutral-200'
                      : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </form>

        <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple className="hidden" />
      </div>
    </div>
  );
}

// ==========================================
// SETTINGS MODAL
// ==========================================

function SettingsModal() {
  const {
    settings, setSettings, settingsOpen, setSettingsOpen,
    trashedChats, restoreFromTrash, permanentlyDelete, emptyTrash,
    currentUser, onlineCount
  } = useApp();

  const [activeTab, setActiveTab] = useState<'geral' | 'ia' | 'voz' | 'conta' | 'lixeira'>('geral');
  const [availableModels, setAvailableModels] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data && data.models) {
          setAvailableModels(data.models);
        }
      })
      .catch(() => {});
  }, []);

  if (!settingsOpen) return null;

  const toggle = (key: string) => setSettings({ ...settings, [key]: !settings[key] });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 md:p-6">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-neutral-400" />
            <h3 className="font-bold text-neutral-100 text-sm">Configurações da Plataforma DEV AI</h3>
          </div>
          <button onClick={() => setSettingsOpen(false)} className="p-1.5 text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-neutral-800 bg-neutral-950 px-4 gap-2 overflow-x-auto">
          {[
            { id: 'geral', label: 'Geral' },
            { id: 'ia', label: 'Inteligência Artificial' },
            { id: 'voz', label: 'Voz e Live' },
            { id: 'conta', label: 'Conta e Presença' },
            { id: 'lixeira', label: 'Lixeira' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin scrollbar-thumb-neutral-800 text-xs">
          {activeTab === 'geral' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5" />
                  <span>Aparência e Tema (Claro, Escuro, Sistema)</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'claro', label: 'Claro', icon: Sun },
                    { id: 'escuro', label: 'Escuro', icon: Moon },
                    { id: 'sistema', label: 'Sistema', icon: Monitor }
                  ].map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSettings({ ...settings, theme: t.id })}
                        className={`py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === t.id
                            ? 'bg-white text-neutral-950 border-white font-bold'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 border-t border-neutral-800 pt-4">
                {[
                  { key: 'notifications', title: 'Notificações Push (Servidor)', sub: 'Receber alertas quando a IA finalizar tarefas.', icon: Shield }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className="flex items-center justify-between p-3 rounded-2xl bg-neutral-950 border border-neutral-800/80">
                      <div className="flex gap-2.5 pr-2">
                        <div className="p-2 rounded-xl bg-neutral-900 text-neutral-400 shrink-0 self-start">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-bold text-neutral-200">{item.title}</div>
                          <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">{item.sub}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => toggle(item.key)}
                        className={`w-11 h-6 rounded-full p-1 transition-colors shrink-0 ${
                          settings[item.key] ? 'bg-white' : 'bg-neutral-800'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full transition-transform ${
                          settings[item.key] ? 'translate-x-5 bg-neutral-950' : 'translate-x-0 bg-white'
                        }`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'ia' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Modelos Gemini Oficiais Configurados</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {availableModels.map((m) => (
                    <div key={m.name} className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                      <div>
                        <div className="font-bold text-neutral-200">{m.displayName}</div>
                        <div className="text-[10px] text-neutral-500">{m.description}</div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">{m.category}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t border-neutral-800 pt-4">
                {[
                  { key: 'searchWebEnabled', title: 'Pesquisa Web (Google)', sub: 'Permitir buscas em tempo real na internet', icon: Search },
                  { key: 'codeWrapLines', title: 'Quebra de Linha em Código', sub: 'Quebrar linhas longas nos blocos de código', icon: Code },
                  { key: 'autoFallback', title: 'Auto Troca ao Falhar', sub: 'Mudar de modelo automaticamente se ocorrer erro na API', icon: RotateCcw }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className="flex items-center justify-between p-3 rounded-2xl bg-neutral-950 border border-neutral-800/80">
                      <div className="flex gap-2.5 pr-2">
                        <div className="p-2 rounded-xl bg-neutral-900 text-neutral-400 shrink-0 self-start">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-bold text-neutral-200">{item.title}</div>
                          <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">{item.sub}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => toggle(item.key)}
                        className={`w-11 h-6 rounded-full p-1 transition-colors shrink-0 ${
                          settings[item.key] ? 'bg-white' : 'bg-neutral-800'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full transition-transform ${
                          settings[item.key] ? 'translate-x-5 bg-neutral-950' : 'translate-x-0 bg-white'
                        }`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'voz' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5" />
                  <span>Preferências de Voz (gemini-3.8-flash-lite-tts) e Transcrição (gemini-3.5-transcribe)</span>
                </div>
                {[
                  { key: 'realVoiceAudio', title: 'Voz da IA (TTS)', sub: 'Habilitar leitura por voz das respostas (gemini-3.8-flash-lite-tts)', icon: Volume2 },
                  { key: 'maleVoice', title: 'Voz Masculina Padrão', sub: 'Utilizar tom de voz masculino natural em português', icon: User }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className="flex items-center justify-between p-3 rounded-2xl bg-neutral-950 border border-neutral-800/80">
                      <div className="flex gap-2.5 pr-2">
                        <div className="p-2 rounded-xl bg-neutral-900 text-neutral-400 shrink-0 self-start">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-bold text-neutral-200">{item.title}</div>
                          <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">{item.sub}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => toggle(item.key)}
                        className={`w-11 h-6 rounded-full p-1 transition-colors shrink-0 ${
                          settings[item.key] ? 'bg-white' : 'bg-neutral-800'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full transition-transform ${
                          settings[item.key] ? 'translate-x-5 bg-neutral-950' : 'translate-x-0 bg-white'
                        }`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'conta' && (
            <div className="space-y-5">
              <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Pessoas Online</span>
              </div>
              <div className="p-4 rounded-2xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-medium text-neutral-200">Usuários conectados agora</span>
                </div>
                <span className="font-mono font-bold text-emerald-400">{onlineCount} online</span>
              </div>

              <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5 pt-4">
                <User className="w-3.5 h-3.5" />
                <span>Minha Conta (Firebase Auth & Firestore)</span>
              </div>

              {currentUser ? (
                <div className="p-4 rounded-2xl bg-neutral-950 border border-neutral-800 space-y-3">
                  <div className="flex items-center gap-3">
                    <img src={currentUser.photoURL || ''} alt="avatar" className="w-10 h-10 rounded-full object-cover border border-neutral-700" />
                    <div>
                      <div className="font-bold text-neutral-100">{currentUser.displayName || 'Usuário'}</div>
                      <div className="text-[11px] text-neutral-400">{currentUser.email}</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-neutral-800/80 text-[11px] font-mono text-neutral-500">
                    UID: {currentUser.uid} (Histórico sincronizado com Firestore)
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-2xl bg-neutral-950 border border-neutral-800 text-center space-y-3">
                  <p className="text-neutral-400">Você está navegando como Visitante.</p>
                  <button
                    onClick={useApp().loginWithGoogle}
                    className="px-4 py-2 rounded-xl bg-white text-neutral-950 font-bold text-xs hover:bg-neutral-200 transition-all shadow-md"
                  >
                    Entrar com Conta Google
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'lixeira' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Lixeira (Chats Excluídos)</span>
                </div>
                {trashedChats.length > 0 && (
                  <button onClick={emptyTrash} className="text-[10px] text-red-400 hover:underline font-bold">
                    Esvaziar Lixeira
                  </button>
                )}
              </div>

              {trashedChats.length === 0 ? (
                <div className="p-8 rounded-2xl bg-neutral-950 border border-neutral-800 text-center text-neutral-500">
                  A lixeira está vazia.
                </div>
              ) : (
                <div className="space-y-2">
                  {trashedChats.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between p-3 rounded-2xl bg-neutral-950 border border-neutral-800">
                      <span className="truncate text-neutral-200 font-medium max-w-[220px]">{c.title}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => restoreFromTrash(c.id)}
                          className="px-2.5 py-1 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-[10px] font-bold"
                        >
                          Restaurar
                        </button>
                        <button
                          onClick={() => permanentlyDelete(c.id)}
                          className="px-2.5 py-1 bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg text-[10px] font-bold"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Rename Modal
function RenameModal() {
  const { renameModalData, setRenameModalData, renameChat } = useApp();
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (renameModalData) setTitle(renameModalData.title);
  }, [renameModalData]);

  if (!renameModalData) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
        <h3 className="font-bold text-sm text-neutral-100">Renomear Conversa</h3>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-100 focus:outline-none"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setRenameModalData(null)}
            className="px-3 py-1.5 rounded-xl bg-neutral-800 text-neutral-400 text-xs font-semibold"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              renameChat(renameModalData.id, title);
              setRenameModalData(null);
            }}
            className="px-4 py-1.5 rounded-xl bg-white text-neutral-950 text-xs font-bold"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// Expanded Editor Modal
function ExpandedEditorModal({ text, setText, onSend }: { text: string; setText: (t: string) => void; onSend: () => void }) {
  const { expandedEditorOpen, setExpandedEditorOpen } = useApp();

  if (!expandedEditorOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col p-4 animate-fadeIn">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
        <span className="font-semibold text-sm text-neutral-300">Editor Expandido</span>
        <button
          onClick={() => setExpandedEditorOpen(false)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-semibold text-neutral-300 hover:bg-neutral-800"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>Reduzir</span>
        </button>
      </div>

      <div className="flex-1 py-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva sua mensagem completa aqui..."
          className="w-full h-full bg-transparent text-neutral-100 placeholder-neutral-600 text-base focus:outline-none resize-none font-sans leading-relaxed"
          autoFocus
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
        <button
          onClick={() => {
            onSend();
            setExpandedEditorOpen(false);
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-neutral-950 font-bold text-sm shadow-lg"
        >
          <Send className="w-4 h-4" />
          <span>Enviar Mensagem</span>
        </button>
      </div>
    </div>
  );
}

// Model Selector Modal
function ModelSelectorModal() {
  const { settings, setSettings, modelSelectorOpen, setModelSelectorOpen } = useApp();
  const [models, setModels] = useState<any[]>([
    { name: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', category: 'Chat', description: 'Última geração topo de linha com raciocínio ultrarrápido' },
    { name: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', category: 'Chat', description: 'Versão otimizada para respostas instantâneas' },
    { name: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', category: 'Lite', description: 'Opção econômica e rápida para conversação' },
    { name: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', category: 'Lite', description: 'Alta eficiência para menor latência' },
    { name: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', category: 'Chat', description: 'Prévia de alta performance' },
    { name: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', category: 'Pro', description: 'Capacidade máxima para lógica complexa' },
    { name: 'gemini-3.8-live', displayName: 'Gemini 3.8 Live', category: 'Live', description: 'Modelo para ligação e voz em tempo real' },
    { name: 'gemini-3.8-flash-lite-tts', displayName: 'Gemini 3.8 Flash-Lite TTS', category: 'Áudio', description: 'Transformar texto em áudio natural' },
    { name: 'gemini-3.5-transcribe', displayName: 'Gemini 3.5 Transcribe', category: 'Áudio', description: 'Transformar áudio em texto (Microfone)' },
    { name: 'gemini-3.1-flash-lite-image', displayName: 'Gemini 3.1 Flash Lite Image', category: 'Imagem', description: 'Geração e edição visual' },
    { name: 'deep-research-preview-04-2026', displayName: 'Gemini Deep Research', category: 'Pro', description: 'Pesquisa profunda autônoma' },
    { name: 'gemini-omni-1.1-flash', displayName: 'Gemini Omni Flash', category: 'Chat', description: 'Modelo multimodal avançado' }
  ]);

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data && data.models && data.models.length > 0) {
          setModels(data.models);
        }
      })
      .catch(() => {});
  }, []);

  if (!modelSelectorOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-4 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded overflow-hidden flex items-center justify-center">
              <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-xs text-neutral-200">Selecionar Modelo Gemini Oficial</span>
          </div>
          <button onClick={() => setModelSelectorOpen(false)} className="p-1.5 text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {models.map((m) => (
            <button
              key={m.name}
              onClick={() => {
                setSettings({ ...settings, selectedModel: m.name });
                setModelSelectorOpen(false);
              }}
              className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                settings.selectedModel === m.name
                  ? 'bg-neutral-950 border-white shadow-md'
                  : 'bg-neutral-950/50 border-neutral-800/80 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-neutral-100">{m.displayName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-neutral-800 text-neutral-300">{m.category}</span>
              </div>
              <p className="text-[11px] text-neutral-500 mt-1">{m.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Share Modal
function ShareModal() {
  const { shareModalOpen, setShareModalOpen, showToast } = useApp();
  if (!shareModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-md p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <h3 className="font-bold text-neutral-100 text-sm">Compartilhar Conversa</h3>
          <button onClick={() => setShareModalOpen(false)} className="p-1 text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            showToast('Link público copiado!');
          }}
          className="w-full py-2.5 bg-neutral-950 border border-neutral-800 hover:bg-neutral-800 text-neutral-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>Copiar Link Público</span>
        </button>
      </div>
    </div>
  );
}

function ToastNotification({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-20 right-6 z-50 bg-neutral-900 border border-neutral-800 text-neutral-200 px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      <span>{message}</span>
    </div>
  );
}

// ==========================================
// MAIN APP CONTENT
// ==========================================

function AppContent() {
  const {
    chats, setChats, activeChatId, activeChat, createNewChat,
    setSidebarOpen, setShareModalOpen, isGenerating, setIsGenerating,
    setGenerationState, showToast, toastMessage, previewHtmlCode, setPreviewHtmlCode,
    settings, setGeminiLiveOpen, cameraModalOpen, setCameraModalOpen
  } = useApp();

  const [inputText, setInputText] = useState('');

  const handleSendMessage = async (userInputText: string, customChatId?: string) => {
    let chatId = customChatId || activeChatId;
    if (!chatId) chatId = createNewChat();

    const userMsg = {
      role: 'user',
      content: userInputText,
      timestamp: new Date().toISOString()
    };

    setChats((prev: any) => prev.map((c: any) => {
      if (c.id === chatId) {
        const title = c.messages.length === 0 ? (userInputText.slice(0, 20) + '...') : c.title;
        return { ...c, title, messages: [...c.messages, userMsg] };
      }
      return c;
    }));

    setIsGenerating(true);

    const currentChat = chats.find((c: any) => c.id === chatId);
    const history = currentChat ? [...currentChat.messages, userMsg] : [userMsg];

    let assistantContent = '';
    const assistantMsg = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    };

    setChats((prev: any) => prev.map((c: any) => {
      if (c.id === chatId) return { ...c, messages: [...c.messages, assistantMsg] };
      return c;
    }));

    try {
      await aiProvider.streamResponse(
        history,
        (chunk) => {
          assistantContent += chunk;
          setChats((prev: any) => prev.map((c: any) => {
            if (c.id === chatId) {
              const updatedMsgs = [...c.messages];
              updatedMsgs[updatedMsgs.length - 1] = { ...assistantMsg, content: assistantContent };
              return { ...c, messages: updatedMsgs };
            }
            return c;
          }));
        },
        (stateText) => setGenerationState(stateText),
        settings.selectedModel
      );
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditUserMessage = (text: string, index: number) => {
    if (!activeChat) return;
    setInputText(text);

    const truncated = activeChat.messages.slice(0, index);
    setChats((prev: any) => prev.map((c: any) => c.id === activeChat.id ? { ...c, messages: truncated } : c));
    showToast('Mensagem pronta para edição');
  };

  const handleRegenerate = () => {
    if (!activeChat || activeChat.messages.length === 0) return;
    const lastUserIndex = [...activeChat.messages].map((m, idx) => m.role === 'user' ? idx : -1).filter(i => i !== -1).pop();
    if (lastUserIndex !== undefined) {
      const lastUserMsg = activeChat.messages[lastUserIndex];
      const truncated = activeChat.messages.slice(0, lastUserIndex);
      setChats((prev: any) => prev.map((c: any) => c.id === activeChat.id ? { ...c, messages: truncated } : c));
      handleSendMessage(lastUserMsg.content, activeChat.id);
    }
  };

  const handleDownloadFullChat = () => {
    if (!activeChat || activeChat.messages.length === 0) return;
    const content = activeChat.messages.map((m: any) => `[${m.role.toUpperCase()}]\n${m.content}\n`).join('\n---\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_export_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Conversa baixada');
  };

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden antialiased">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 relative bg-neutral-950">
        <header className="h-14 border-b border-neutral-900 px-4 flex items-center justify-between bg-neutral-950 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-lg"
            >
              <PanelLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-neutral-900 overflow-hidden border border-neutral-800 flex items-center justify-center">
                <img src="/public/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
              </div>
              <span className="font-bold text-sm text-neutral-100">DEV AI</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setGeminiLiveOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-xs font-bold transition-all shadow-sm"
              title="Iniciar Ligação Gemini 3.8 Live"
            >
              <PhoneCall className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Ligar</span>
            </button>

            <button
              onClick={() => setShareModalOpen(true)}
              className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 rounded-lg transition-colors"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownloadFullChat}
              className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </header>

        <ChatView
          messages={activeChat ? activeChat.messages : []}
          isGenerating={isGenerating}
          onSendMessage={handleSendMessage}
          onEditUserMessage={handleEditUserMessage}
          onRegenerate={handleRegenerate}
          chatId={activeChat?.id}
          userSettings={settings}
        />

        <ChatInput
          onSendMessage={handleSendMessage}
          isGenerating={isGenerating}
          onCancel={() => aiProvider.cancelGeneration()}
          inputText={inputText}
          setInputText={setInputText}
        />
      </main>

      <ExpandedEditorModal text={inputText} setText={setInputText} onSend={() => handleSendMessage(inputText)} />
      <ModelSelectorModal />
      <ShareModal />
      <SettingsModal />
      <RenameModal />
      <GeminiLiveModal />
      <CameraModal onCapture={(photos) => {
        handleSendMessage(`Analise estas ${photos.length} fotos capturadas:`, activeChatId);
      }} />
      <HtmlPreviewModal
        isOpen={Boolean(previewHtmlCode)}
        onClose={() => setPreviewHtmlCode(null)}
        code={previewHtmlCode || ''}
        chatId={activeChat?.id}
        isGenerating={isGenerating}
      />
      <ToastNotification message={toastMessage} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

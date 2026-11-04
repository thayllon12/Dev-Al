import React, { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageSquare, Plus, Trash2, Edit3, Search, Settings, PanelLeft,
  Send, Paperclip, Mic, Image, Copy, CheckCheck, RefreshCw, Sun, Moon, Monitor, Code,
  Sparkles, User, Bot, X, ChevronRight, Download, Play, Maximize2, Minimize2,
  Terminal, Zap, Shield, Info, Cpu, Volume2, VolumeX, MoreVertical, Share2,
  FileText, Video, Music, Camera, File, CheckCircle2, UserPlus, Users, Lock, Eye, Edit2,
  Square, ArrowUpRight, RotateCcw, Sliders, HardDrive, AlertTriangle, EyeOff, Radio,
  PhoneCall, PhoneOff, MonitorUp, LogIn, LogOut, Check, Palette, UserCheck,
  ZapOff, ChevronDown
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
    selectedModel: string = 'gemini-3.8-flash',
    personalityPrompt: string = ''
  ) {
    this.abortController = new AbortController();

    const updateState = async (stateText: string, delay: number) => {
      if (this.abortController?.signal.aborted) throw new Error('Aborted');
      onStateChange(stateText);
      await new Promise(r => setTimeout(r, delay));
    };

    try {
      await updateState('Conectando ao Gemini...', 250);
      await updateState('Pensando...', 350);

      const cleanMessages = messages.filter((m: any) => 
        (m.content && m.content.trim().length > 0) || (Array.isArray(m.attachments) && m.attachments.length > 0)
      );

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: cleanMessages, 
          model: selectedModel,
          personalityPrompt: personalityPrompt 
        }),
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
                onChunk(`\n\n> **⚠️ Aviso do Sistema:** ${parsed.error}`);
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
        onChunk('\n\n> **🔴 Erro Crítico:** Não foi possível estabelecer conexão com o servidor ou os limites de cota foram excedidos. \n\n*Iniciando modo de resposta local de emergência:* \n\nOlá! Parece que estou enfrentando uma alta demanda no momento. Por favor, tente novamente em alguns instantes ou verifique sua conexão.');
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
  userName: 'Usuário',
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
  const [chats, setChats] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('DEV_AI_CHATS_V6_FIREBASE');
      return saved ? JSON.parse(saved) : [];
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

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  
  // Theme state initialized from localStorage for zero-flicker (partially)
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('DEV_AI_SETTINGS_V6');
      const parsed = saved ? JSON.parse(saved) : {};
      return { ...DEFAULT_SETTINGS, ...parsed };
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
  const [imageGenModalOpen, setImageGenModalOpen] = useState(false);
  const [renameModalData, setRenameModalData] = useState<any>(null);

  const [myUserId] = useState<string>(() => {
    let saved = localStorage.getItem('DEV_AI_MY_USER_ID_V7');
    if (!saved) {
      saved = 'user_' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem('DEV_AI_MY_USER_ID_V7', saved);
    }
    return saved;
  });
  const effectiveUserId = currentUser?.uid || myUserId;

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationTime, setGenerationTime] = useState(0);
  const [generationState, setGenerationState] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [previewHtmlCode, setPreviewHtmlCode] = useState<string | null>(null);
  const [textSelectionData, setTextSelectionData] = useState<string | null>(null);
  const [selectedMediaPreview, setSelectedMediaPreview] = useState<any>(null);
  const [onlineCount, setOnlineCount] = useState(1);

  // Auto-sync shared chats with my user ID
  useEffect(() => {
    const inboxKey = `DEV_AI_SHARED_INBOX_${effectiveUserId}`;
    try {
      const savedShared = localStorage.getItem(inboxKey);
      if (savedShared) {
        const parsed = JSON.parse(savedShared);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChats(prev => {
            const map = new Map();
            prev.forEach(c => map.set(c.id, c));
            parsed.forEach((sc: any) => {
              if (!map.has(sc.id)) {
                map.set(sc.id, sc);
              }
            });
            return Array.from(map.values());
          });
        }
      }
    } catch (e) {
      console.error('Error syncing shared chats:', e);
    }
  }, [effectiveUserId]);

  // Apply theme immediately
  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      const isDark = settings.theme === 'escuro' || (settings.theme === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      
      if (isDark) {
        root.classList.add('dark');
        root.style.colorScheme = 'dark';
      } else {
        root.classList.remove('dark');
        root.style.colorScheme = 'light';
      }
    };

    applyTheme();

    // Listen for system theme changes
    if (settings.theme === 'sistema') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [settings.theme]);

  // Auth & Data Load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          // Load User Profile (Settings)
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.settings) {
              setSettings((prev: any) => ({ ...prev, ...userData.settings }));
            }
          }

          // Load Chats
          const chatsRef = doc(db, 'users', user.uid, 'data', 'chats');
          const chatsSnap = await getDoc(chatsRef);
          if (chatsSnap.exists()) {
            const cloudChats = chatsSnap.data().chats;
            if (cloudChats && cloudChats.length > 0) {
              setChats(cloudChats);
              if (!activeChatId) setActiveChatId(cloudChats[0].id);
            }
          }

          // Online Presence (Real)
          const presenceRef = doc(db, 'presence', user.uid);
          await setDoc(presenceRef, { 
            lastSeen: new Date().toISOString(),
            email: user.email 
          }, { merge: true });

          // Periodic Presence Update
          const interval = setInterval(async () => {
            await setDoc(presenceRef, { lastSeen: new Date().toISOString() }, { merge: true });
          }, 60000); // Every 1 min

          return () => clearInterval(interval);
        } catch (e) {
          console.error('Error loading data:', e);
        }
      } else {
        // Default chat for guests
        if (chats.length === 0) {
          const id = 'chat_guest_' + Date.now();
          setChats([{ id, title: 'Nova Conversa', messages: [], createdAt: new Date().toISOString() }]);
          setActiveChatId(id);
        } else if (!activeChatId) {
          setActiveChatId(chats[0].id);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync Settings to Cloud/Local
  useEffect(() => {
    localStorage.setItem('DEV_AI_SETTINGS_V6', JSON.stringify(settings));
    if (currentUser) {
      const userRef = doc(db, 'users', currentUser.uid);
      setDoc(userRef, { settings }, { merge: true }).catch(e => console.error(e));
    }
  }, [settings, currentUser]);

  // Sync Chats to Local
  useEffect(() => {
    localStorage.setItem('DEV_AI_CHATS_V6_FIREBASE', JSON.stringify(chats));
    if (currentUser) {
      const chatsRef = doc(db, 'users', currentUser.uid, 'data', 'chats');
      setDoc(chatsRef, { chats }, { merge: true }).catch(e => console.error(e));
    }
  }, [chats, currentUser]);

  // Global Online Counter (Real-ish simulation based on recent presence)
  useEffect(() => {
    const fetchOnlineCount = async () => {
      try {
        // This is a simple version. In a real app, you'd use a cloud function or a count query.
        // For now, we'll fetch a sample or just use a dynamic realistic number if we don't want to query all users.
        const q = collection(db, 'presence');
        const snap = await getDocs(q);
        const now = new Date().getTime();
        const active = snap.docs.filter(d => {
          const lastSeen = new Date(d.data().lastSeen).getTime();
          return (now - lastSeen) < 300000; // 5 minutes
        }).length;
        setOnlineCount(Math.max(active, 1));
      } catch (e) {
        console.error('Error fetching online count:', e);
      }
    };

    fetchOnlineCount();
    const interval = setInterval(fetchOnlineCount, 30000);
    return () => clearInterval(interval);
  }, []);

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

  const showToast = (_text: string) => {
    // User requested to completely remove notifications from the app
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
    const newChatId = 'chat_' + Date.now();
    const newChat = {
      id: newChatId,
      title: 'Nova Conversa',
      createdAt: new Date().toISOString(),
      messages: [],
      ownerId: effectiveUserId,
      myRole: 'admin',
      isShared: false,
      sharedUsers: []
    };
    setChats((prev: any) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    return newChat.id;
  };

  const shareChatWithUser = (chatId: string, targetId: string, role: 'viewer' | 'editor' | 'admin') => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return false;

    const existingUsers = Array.isArray(chat.sharedUsers) ? [...chat.sharedUsers] : [];
    const idx = existingUsers.findIndex(u => u.userId === targetId.trim());
    if (idx >= 0) {
      existingUsers[idx].role = role;
    } else {
      existingUsers.push({ userId: targetId.trim(), role, addedAt: new Date().toISOString() });
    }

    const updatedChat = {
      ...chat,
      isShared: true,
      sharedUsers: existingUsers
    };

    setChats(prev => prev.map(c => c.id === chatId ? updatedChat : c));

    // Save into target user's shared inbox
    try {
      const targetInboxKey = `DEV_AI_SHARED_INBOX_${targetId.trim()}`;
      const targetInbox = JSON.parse(localStorage.getItem(targetInboxKey) || '[]');
      const filtered = targetInbox.filter((c: any) => c.id !== chatId);
      filtered.unshift({
        ...updatedChat,
        isShared: true,
        myRole: role,
        sharedBy: currentUser?.displayName || effectiveUserId
      });
      localStorage.setItem(targetInboxKey, JSON.stringify(filtered));
    } catch (e) {
      console.error(e);
    }

    return true;
  };

  const updateSharedUserRole = (chatId: string, targetId: string, newRole: 'viewer' | 'editor' | 'admin') => {
    return shareChatWithUser(chatId, targetId, newRole);
  };

  const removeSharedUser = (chatId: string, targetId: string) => {
    setChats(prev => prev.map(c => {
      if (c.id === chatId) {
        const remaining = (c.sharedUsers || []).filter((u: any) => u.userId !== targetId);
        return {
          ...c,
          sharedUsers: remaining,
          isShared: remaining.length > 0
        };
      }
      return c;
    }));
    try {
      const targetInboxKey = `DEV_AI_SHARED_INBOX_${targetId}`;
      const targetInbox = JSON.parse(localStorage.getItem(targetInboxKey) || '[]');
      const filtered = targetInbox.filter((c: any) => c.id !== chatId);
      localStorage.setItem(targetInboxKey, JSON.stringify(filtered));
    } catch (e) {
      console.error(e);
    }
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
    return chats.find((c: any) => c.id === (activeChatId || '')) || null;
  }, [chats, activeChatId]);

  return (
    <AppContext.Provider value={{
      currentUser, loginWithGoogle, logout, myUserId: effectiveUserId,
      chats, setChats, trashedChats, activeChatId, setActiveChatId, activeChat, createNewChat,
      moveToTrash, restoreFromTrash, permanentlyDelete, emptyTrash, renameChat, settings, setSettings,
      sidebarOpen, setSidebarOpen, settingsOpen, setSettingsOpen, shareModalOpen, setShareModalOpen,
      modelSelectorOpen, setModelSelectorOpen, expandedEditorOpen, setExpandedEditorOpen,
      geminiLiveOpen, setGeminiLiveOpen, cameraModalOpen, setCameraModalOpen,
      imageGenModalOpen, setImageGenModalOpen,
      renameModalData, setRenameModalData, isGenerating, setIsGenerating,
      generationTime, generationState, setGenerationState, showToast, toastMessage,
      previewHtmlCode, setPreviewHtmlCode, onlineCount,
      textSelectionData, setTextSelectionData,
      selectedMediaPreview, setSelectedMediaPreview,
      shareChatWithUser, updateSharedUserRole, removeSharedUser
    }}>
      {children}
    </AppContext.Provider>
  );
}

const useApp = () => useContext(AppContext);

// ==========================================
// UTILITY COMPONENTS
// ==========================================

function PortalMenu({ isOpen, onClose, triggerRef, children }: { isOpen: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }) {
  const [coords, setCoords] = useState({ top: 0, left: 0, translateY: '4px' });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 200;
      const menuHeight = 220;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let left = rect.right;
      if (left > viewportWidth - 8) {
        left = viewportWidth - 8;
      }
      if (left < menuWidth + 8) {
        left = menuWidth + 8;
      }

      // Check vertical space: if not enough space below, open UPWARDS!
      let top = rect.bottom;
      let translateY = '4px';
      if (rect.bottom + menuHeight > viewportHeight - 16) {
        top = rect.top;
        translateY = 'calc(-100% - 4px)';
      }

      setCoords({
        top,
        left,
        translateY
      });
    }
  }, [isOpen, triggerRef]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return createPortal(
    <div 
      ref={menuRef}
      className="fixed z-[50000] animate-in zoom-in-95 fade-in duration-200"
      style={{ 
        top: `${coords.top}px`, 
        left: `${coords.left}px`,
        transform: `translateX(-100%) translateY(${coords.translateY})`
      }}
    >
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl overflow-hidden py-1.5 w-52">
        {children}
      </div>
    </div>,
    document.body
  );
}

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
      elements.push(<h3 key={idx} className="text-base md:text-lg font-bold text-neutral-900 dark:text-neutral-100 my-2">{line.replace('### ', '')}</h3>);
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={idx} className="text-lg md:text-xl font-bold text-neutral-900 dark:text-neutral-100 my-3">{line.replace('## ', '')}</h2>);
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(<h1 key={idx} className="text-xl md:text-2xl font-extrabold text-neutral-900 dark:text-neutral-100 my-4">{line.replace('# ', '')}</h1>);
      return;
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('1. ')) {
      const itemText = line.replace(/^(\d+\.|\-)\s+/, '');
      elements.push(
        <li key={idx} className="ml-4 list-disc text-neutral-700 dark:text-neutral-300 my-1">
          {inlineFormatting(itemText)}
        </li>
      );
      return;
    }

    if (line.trim() !== '') {
      elements.push(
        <p key={idx} className="text-neutral-800 dark:text-neutral-200 leading-relaxed my-2 break-words">
          {inlineFormatting(line)}
        </p>
      );
    }
  });

  function inlineFormatting(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-neutral-900 dark:text-neutral-100">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic text-neutral-700 dark:text-neutral-300">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="bg-neutral-200 dark:bg-neutral-800/80 text-neutral-800 dark:text-neutral-200 px-1.5 py-0.5 rounded text-xs font-mono border border-neutral-300 dark:border-neutral-700/60">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  }

  return <div className="text-sm md:text-base leading-relaxed">{elements}</div>;
}

// ==========================================
// SIDEBAR (USING OFFICIAL LOGO)
// ==========================================

function SidebarChatItem({ chat, activeChatId, setActiveChatId, setSidebarOpen, setRenameModalData, moveToTrash, showToast }: { 
  chat: any; 
  activeChatId: string | null; 
  setActiveChatId: (id: string) => void; 
  setSidebarOpen: (o: boolean) => void;
  setRenameModalData: (d: any) => void;
  moveToTrash: (id: string) => void;
  showToast: (m: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<any>(null);
  const isActive = chat.id === activeChatId;

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      setIsMenuOpen(true);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const isShared = Boolean(chat.isShared || (chat.sharedUsers && chat.sharedUsers.length > 0) || chat.myRole);
  const roleLabel = chat.myRole === 'viewer' ? 'Somente ver' : chat.myRole === 'editor' ? 'Editor' : 'Admin';

  return (
    <div
      ref={triggerRef}
      onClick={() => {
        setActiveChatId(chat.id);
        if (window.innerWidth < 768) setSidebarOpen(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setIsMenuOpen(true);
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all select-none ${
        isActive
          ? 'bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800/80 text-neutral-900 dark:text-neutral-100 font-medium'
          : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 hover:text-neutral-700 dark:hover:text-neutral-200'
      }`}
    >
      <div className="flex items-center min-w-0 flex-1 pr-2">
        {/* Personagenzinho Verde mostrando que aquele chat é compartilhado */}
        {isShared && (
          <div 
            className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 flex items-center justify-center shrink-0 mr-2 shadow-xs"
            title={`Chat compartilhado (${roleLabel})`}
          >
            <UserCheck className="w-3 h-3 text-emerald-500" />
          </div>
        )}
        <span className="truncate flex-1">{chat.title}</span>
      </div>

      <div className="relative">
        <button
          ref={menuBtnRef}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          className="p-1 md:opacity-0 md:group-hover:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 rounded-lg transition-opacity"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>

        <PortalMenu 
          isOpen={isMenuOpen} 
          onClose={() => setIsMenuOpen(false)} 
          triggerRef={menuBtnRef}
        >
          {isShared ? (
            <div className="px-3 py-1.5 text-[10px] font-bold text-emerald-500 uppercase border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <span>Compartilhado</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 font-bold">{roleLabel}</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase border-b border-neutral-100 dark:border-neutral-800">
              Opções
            </div>
          )}

          {isShared && chat.myRole !== 'viewer' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveChatId(chat.id);
                setIsMenuOpen(false);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <Edit2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Escrever mensagem</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              setRenameModalData({ id: chat.id, title: chat.title });
              setIsMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Renomear</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              showToast('Conversa fixada no topo');
              setIsMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <Paperclip className="w-3.5 h-3.5" />
            <span>Fixar Conversa</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveToTrash(chat.id);
              setIsMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Excluir</span>
          </button>
        </PortalMenu>
      </div>
    </div>
  );
}

function ChatMessageItem({ 
  msg, index, chatId, userSettings, isGenerating, onRegenerate, onEditUserMessage, handleTTS, handleCopy, handleDownloadResponse, speakingIndex 
}: {
  msg: any;
  index: number;
  chatId: string | null;
  userSettings: any;
  isGenerating: boolean;
  onRegenerate: () => void;
  onEditUserMessage: (t: string, i: number) => void;
  handleTTS: (i: number, t: string) => void;
  handleCopy: (t: string) => void;
  handleDownloadResponse: (t: string) => void;
  speakingIndex: number | null;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { setTextSelectionData, setSelectedMediaPreview } = useApp();
  const isUser = msg.role === 'user';

  const messageTime = useMemo(() => {
    try {
      const d = msg.timestamp ? new Date(msg.timestamp) : new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [msg.timestamp]);

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1 group relative`}>
      {isUser ? (
        <>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-[11px] shadow-xs">
              {userSettings.userName.charAt(0)}
            </div>
          </div>
          <span className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider pr-1">
            {userSettings.userName}
          </span>
          <div className="relative group/bubble bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-2xl px-4 py-2.5 text-sm max-w-[85%] shadow-xs space-y-2">
            {/* Render user attachments if present */}
            {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pb-1">
                {msg.attachments.map((att: any, attIdx: number) => (
                  <div
                    key={att.id || attIdx}
                    onClick={() => setSelectedMediaPreview && setSelectedMediaPreview(att)}
                    className="relative overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700 bg-black/5 dark:bg-black/30 cursor-pointer hover:opacity-90 transition-all shadow-xs"
                    title="Clique para expandir"
                  >
                    {att.type === 'image' || (att.url && (att.url.startsWith('data:image') || att.url.match(/\.(jpeg|jpg|gif|png|webp)/i))) ? (
                      <img src={att.url} alt={att.name || 'Foto'} className="max-w-[220px] max-h-[180px] object-cover rounded-xl" />
                    ) : att.type === 'video' || (att.url && (att.url.startsWith('data:video') || att.url.match(/\.(mp4|webm)/i))) ? (
                      <video src={att.url} className="max-w-[220px] max-h-[180px] rounded-xl object-cover" />
                    ) : (
                      <div className="flex items-center gap-2 p-2.5 text-xs text-neutral-800 dark:text-neutral-200">
                        <FileText className="w-5 h-5 text-emerald-500 shrink-0" />
                        <div className="truncate max-w-[130px]">
                          <div className="truncate font-semibold">{att.name || 'Arquivo'}</div>
                          <div className="text-[9px] opacity-70">{att.size || 'Documento'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {msg.content && <div>{msg.content}</div>}
          </div>
          <div className="flex items-center gap-1 pt-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => handleCopy(msg.content)}
              className="p-1 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
              title="Copiar mensagem"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              ref={triggerRef}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
              title="Mais opções"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            <PortalMenu 
              isOpen={isMenuOpen} 
              onClose={() => setIsMenuOpen(false)} 
              triggerRef={triggerRef}
            >
              <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                <span>{messageTime}</span>
              </div>
              <button
                onClick={() => { handleCopy(msg.content); setIsMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar mensagem</span>
              </button>
              <button
                onClick={() => { setTextSelectionData(msg.content); setIsMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Selecionar texto</span>
              </button>
              <button
                onClick={() => { onEditUserMessage(msg.content, index); setIsMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Editar mensagem</span>
              </button>
            </PortalMenu>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center border border-neutral-200 dark:border-neutral-700 shadow-xs overflow-hidden">
                <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="AI" className="w-full h-full object-cover" />
            </div>
            <span className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">DEV AI</span>
          </div>
          <div className="text-neutral-800 dark:text-neutral-200 text-sm md:text-base leading-relaxed pl-1 w-full max-w-full overflow-x-hidden">
            <MarkdownRenderer content={msg.content} chatId={chatId} userSettings={userSettings} isGenerating={isGenerating} />
          </div>
          <div className="flex items-center gap-1 mt-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
             <button
               onClick={() => handleTTS(index, msg.content)}
               className={`p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 transition-colors ${speakingIndex === index ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
               title="Ouvir resposta"
             >
               <Volume2 className="w-4 h-4" />
             </button>
             <button
               onClick={() => handleCopy(msg.content)}
               className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 transition-colors"
               title="Copiar resposta"
             >
               <Copy className="w-4 h-4" />
             </button>
             <button
               onClick={() => onRegenerate && onRegenerate()}
               className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 transition-colors"
               title="Regenerar resposta"
             >
               <RefreshCw className="w-4 h-4" />
             </button>

             <div className="relative">
               <button
                 ref={triggerRef}
                 onClick={() => setIsMenuOpen(!isMenuOpen)}
                 className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 transition-colors bg-white dark:bg-neutral-900"
                 title="Opções da resposta"
               >
                 <MoreVertical className="w-4 h-4" />
               </button>

               <PortalMenu 
                isOpen={isMenuOpen} 
                onClose={() => setIsMenuOpen(false)} 
                triggerRef={triggerRef}
               >
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                    <span>{messageTime}</span>
                  </div>
                  <button
                    onClick={() => { handleCopy(msg.content); setIsMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar resposta</span>
                  </button>
                  <button
                    onClick={() => { setTextSelectionData(msg.content); setIsMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Selecionar texto</span>
                  </button>
                  <button
                    onClick={() => { handleTTS(index, msg.content); setIsMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Ouvir resposta</span>
                  </button>
                  <button
                    onClick={() => { handleDownloadResponse(msg.content); setIsMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar resposta (.md)</span>
                  </button>
                  <button
                    onClick={() => { onRegenerate && onRegenerate(); setIsMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Regenerar resposta</span>
                  </button>
                </PortalMenu>
             </div>
           </div>
        </>
      )}
    </div>
  );
}

function Sidebar() {
  const {
    chats, activeChatId, setActiveChatId, createNewChat, moveToTrash,
    sidebarOpen, setSidebarOpen, setSettingsOpen, setRenameModalData,
    currentUser, loginWithGoogle, logout, onlineCount, showToast, myUserId
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');

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
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-900 w-72 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-none'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-900">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-900 overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm flex items-center justify-center">
              <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-neutral-900 dark:text-neutral-100 text-sm tracking-wide">DEV AI</span>
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
              className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-700"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 py-1 scrollbar-thin scrollbar-thumb-neutral-800">
          <div className="px-2 py-1 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
            Histórico
          </div>

          {filteredChats.map((chat: any) => (
            <SidebarChatItem 
              key={chat.id} 
              chat={chat} 
              activeChatId={activeChatId} 
              setActiveChatId={setActiveChatId} 
              setSidebarOpen={setSidebarOpen}
              setRenameModalData={setRenameModalData}
              moveToTrash={moveToTrash}
              showToast={showToast}
            />
          ))}
        </div>

        <div className="p-3 border-t border-neutral-200 dark:border-neutral-900 bg-white dark:bg-neutral-950 space-y-2">
          {currentUser ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs">
                <div className="flex items-center gap-2 truncate pr-2">
                  <img src={currentUser.photoURL || ''} alt="avatar" className="w-6 h-6 rounded-full object-cover" />
                  <span className="truncate text-neutral-700 dark:text-neutral-200 font-medium">{currentUser.displayName || currentUser.email}</span>
                </div>
                <button onClick={logout} className="p-1 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white" title="Sair">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
              
              <div className="px-3 py-1 space-y-1">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[10px] text-neutral-500">
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(currentUser.uid);
                        showToast('ID copiado!');
                      }}
                      className="font-mono uppercase opacity-70 hover:opacity-100 hover:text-neutral-900 dark:hover:text-neutral-100 transition-all flex items-center gap-1"
                      title="Copiar meu ID de Usuário"
                    >
                      ID: {currentUser.uid.slice(0, 8)}...
                      <Copy className="w-2.5 h-2.5" />
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>{onlineCount} online</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={loginWithGoogle}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-800 text-xs font-semibold transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Entrar com Google</span>
              </button>
              <div className="flex items-center justify-between px-3 py-1 text-[10px] text-neutral-500">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(myUserId);
                    showToast('Seu ID foi copiado!');
                  }}
                  className="font-mono uppercase opacity-70 hover:opacity-100 hover:text-neutral-900 dark:hover:text-neutral-100 transition-all flex items-center gap-1"
                  title="Copiar seu ID de Usuário"
                >
                  ID: {myUserId}
                  <Copy className="w-2.5 h-2.5" />
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{onlineCount} online</span>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-xs transition-colors"
          >
            <Settings className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
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
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const handleTTS = (index: number, text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) {
      showToast('Síntese de voz não suportada');
      return;
    }
    if (speakingIndex === index) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
      setSpeakingIndex(null);
      return;
    }
    try { window.speechSynthesis.cancel(); } catch (e) {}
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const maleVoice = voices.find(v => v.lang.includes('pt') && (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('antonio') || v.name.toLowerCase().includes('lucas')));
    if (maleVoice) utterance.voice = maleVoice;

    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);
    try {
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
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
        <div className="w-16 h-16 rounded-3xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-xl flex items-center justify-center">
          <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Como posso ajudar?</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Escolha uma sugestão abaixo ou digite sua solicitação para começar com o Gemini 3.8 Flash.</p>
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
              className="p-3 rounded-2xl bg-neutral-100/60 hover:bg-neutral-100 dark:bg-neutral-900/60 dark:hover:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 text-left transition-all"
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
        {messages.map((msg, index) => (
          <ChatMessageItem 
            key={index} 
            msg={msg} 
            index={index} 
            chatId={chatId} 
            userSettings={userSettings} 
            isGenerating={isGenerating}
            onRegenerate={onRegenerate}
            onEditUserMessage={onEditUserMessage}
            handleTTS={handleTTS}
            handleCopy={handleCopy}
            handleDownloadResponse={handleDownloadResponse}
            speakingIndex={speakingIndex}
          />
        ))}


        {isGenerating && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-900 overflow-hidden border border-neutral-200 dark:border-neutral-800 flex items-center justify-center shadow-xs">
                <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
              </div>
              <span className="font-bold text-neutral-900 dark:text-neutral-200">DEV AI</span>
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
              <span className="text-neutral-600 dark:text-neutral-400">{generationState || 'Pensando...'}</span>
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
              <span className="font-mono text-neutral-500 dark:text-neutral-400">{formatTimer(generationTime)}</span>
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
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Android Camera states matching screenshot 1
  const [zoom, setZoom] = useState<'0.6' | '1x' | '2'>('1x');
  const [flashMode, setFlashMode] = useState<'off' | 'auto' | 'on'>('off');
  const [activeMode, setActiveMode] = useState<'noite' | 'video' | 'foto' | 'retrato' | 'pro'>('foto');
  const [activeFilter, setActiveFilter] = useState<'none' | 'vivid' | 'warm' | 'bw' | 'retro'>('none');
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showLevel, setShowLevel] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<0 | 3 | 10>(0);

  useEffect(() => {
    if (cameraModalOpen) {
      setCameraError(null);
      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraError('Câmera não suportada neste dispositivo.');
        return;
      }
      navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      })
        .then(s => {
          setStream(s);
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(err => {
          console.error('Erro ao acessar câmera:', err);
          setCameraError('Permissão da câmera negada ou dispositivo indisponível.');
        });
    } else {
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
        setStream(null);
      }
      setCapturedPhotos([]);
      setShowSettingsDrawer(false);
      setCountdown(null);
    }
    return () => {
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      }
    };
  }, [cameraModalOpen, facingMode]);

  if (!cameraModalOpen) return null;

  const takeSnapshot = () => {
    if (timerSeconds > 0 && countdown === null) {
      setCountdown(timerSeconds);
      let count = timerSeconds;
      const interval = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(interval);
          setCountdown(null);
          executeCapture();
        } else {
          setCountdown(count);
        }
      }, 1000);
      return;
    }
    executeCapture();
  };

  const executeCapture = () => {
    if (videoRef.current) {
      // Trigger white flash animation
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 160);

      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      const rawW = video.videoWidth || 1280;
      const rawH = video.videoHeight || 720;
      const maxDim = 1024;
      let targetW = rawW;
      let targetH = rawH;

      if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
          targetH = Math.round((targetH * maxDim) / targetW);
          targetW = maxDim;
        } else {
          targetW = Math.round((targetW * maxDim) / targetH);
          targetH = maxDim;
        }
      }

      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Apply filter to canvas if selected
        if (activeFilter === 'bw') ctx.filter = 'grayscale(100%)';
        else if (activeFilter === 'warm') ctx.filter = 'sepia(30%) saturate(140%)';
        else if (activeFilter === 'vivid') ctx.filter = 'saturate(160%) contrast(110%)';
        else if (activeFilter === 'retro') ctx.filter = 'contrast(120%) brightness(90%) sepia(20%)';

        ctx.drawImage(video, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
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

  const cycleFlash = () => {
    if (flashMode === 'off') setFlashMode('auto');
    else if (flashMode === 'auto') setFlashMode('on');
    else setFlashMode('off');
  };

  const cycleFilter = () => {
    const filters: Array<'none' | 'vivid' | 'warm' | 'bw' | 'retro'> = ['none', 'vivid', 'warm', 'bw', 'retro'];
    const nextIdx = (filters.indexOf(activeFilter) + 1) % filters.length;
    setActiveFilter(filters[nextIdx]);
  };

  const getZoomScale = () => {
    if (zoom === '0.6') return 'scale(0.85)';
    if (zoom === '2') return 'scale(1.5)';
    return 'scale(1)';
  };

  const getFilterStyle = () => {
    if (activeFilter === 'bw') return 'grayscale(100%)';
    if (activeFilter === 'warm') return 'sepia(30%) saturate(140%)';
    if (activeFilter === 'vivid') return 'saturate(160%) contrast(110%)';
    if (activeFilter === 'retro') return 'contrast(120%) brightness(90%) sepia(20%)';
    return 'none';
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black text-white select-none overflow-hidden font-sans">
      {/* 1. FULL SCREEN VIEWFINDER BACKGROUND */}
      <div className="absolute inset-0 w-full h-full bg-neutral-950 flex items-center justify-center overflow-hidden">
        {cameraError ? (
          <div className="p-8 text-center text-red-400 space-y-2 z-10">
            <AlertTriangle className="w-12 h-12 mx-auto" />
            <p className="text-sm font-medium">{cameraError}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300"
            style={{
              transform: getZoomScale(),
              filter: getFilterStyle()
            }}
          />
        )}

        {/* Shutter Flash Animation */}
        {flashActive && (
          <div className="absolute inset-0 bg-white z-30 pointer-events-none transition-opacity duration-150" />
        )}

        {/* Timer Countdown Overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none bg-black/40">
            <span className="text-8xl font-extrabold text-amber-400 animate-ping">
              {countdown}
            </span>
          </div>
        )}

        {/* Corner Brackets */}
        <div className="absolute top-16 left-6 w-6 h-6 border-t-2 border-l-2 border-white/70 rounded-tl-xs pointer-events-none z-10" />
        <div className="absolute top-16 right-6 w-6 h-6 border-t-2 border-r-2 border-white/70 rounded-tr-xs pointer-events-none z-10" />
        <div className="absolute bottom-28 left-6 w-6 h-6 border-b-2 border-l-2 border-white/70 rounded-bl-xs pointer-events-none z-10" />
        <div className="absolute bottom-28 right-6 w-6 h-6 border-b-2 border-r-2 border-white/70 rounded-br-xs pointer-events-none z-10" />
      </div>

      {/* 2. TOP HEADER BAR: "Voltar" (Top Left) & "Enviar" (Top Right) */}
      <div className="absolute top-0 inset-x-0 p-4 pt-6 flex items-center justify-between z-30 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        {/* Top Left: Voltar */}
        <button
          type="button"
          onClick={() => setCameraModalOpen(false)}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/20 text-white font-bold text-sm hover:bg-black/70 active:scale-95 transition-all"
        >
          <X className="w-5 h-5" />
          <span>Voltar</span>
        </button>

        {/* Top Center: Flash toggle */}
        <button
          type="button"
          onClick={cycleFlash}
          className="p-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/90 hover:text-white"
          title={`Flash: ${flashMode.toUpperCase()}`}
        >
          {flashMode === 'off' ? (
            <ZapOff className="w-5 h-5" />
          ) : (
            <Zap className={`w-5 h-5 ${flashMode === 'on' ? 'fill-amber-400 text-amber-400' : 'text-white'}`} />
          )}
        </button>

        {/* Top Right: Enviar */}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={capturedPhotos.length === 0}
          className="flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-neutral-800/80 disabled:text-neutral-500 text-white font-bold text-sm shadow-xl active:scale-95 transition-all disabled:pointer-events-none"
        >
          <Send className="w-4 h-4" />
          <span>Enviar {capturedPhotos.length > 0 ? `(${capturedPhotos.length})` : ''}</span>
        </button>
      </div>

      {/* 3. BOTTOM CONTROLS BAR: "Imagens" | "Tirar foto" | "Rotação" */}
      <div className="absolute bottom-0 inset-x-0 pb-8 pt-12 px-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-around z-30">
        {/* Left: Imagens */}
        <div className="flex flex-col items-center gap-1.5 min-w-[70px]">
          <button
            type="button"
            onClick={capturedPhotos.length > 0 ? handleConfirm : undefined}
            className="relative w-14 h-14 rounded-2xl bg-neutral-900/80 border border-white/20 flex items-center justify-center text-white overflow-hidden shadow-lg active:scale-90 transition-transform"
          >
            {capturedPhotos.length > 0 ? (
              <>
                <img src={capturedPhotos[capturedPhotos.length - 1]} alt="thumb" className="w-full h-full object-cover" />
                <div className="absolute top-1 right-1 bg-emerald-500 text-white font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                  {capturedPhotos.length}
                </div>
              </>
            ) : (
              <Image className="w-6 h-6 text-white/90" />
            )}
          </button>
          <span className="text-xs font-semibold text-white/90">Imagens</span>
        </div>

        {/* Center: Tirar foto */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={takeSnapshot}
            className="w-20 h-20 rounded-full border-4 border-white p-1 flex items-center justify-center active:scale-90 transition-all shadow-2xl focus:outline-none"
            title="Tirar foto"
          >
            <div className="w-full h-full rounded-full bg-white active:bg-neutral-300 transition-colors" />
          </button>
          <span className="text-xs font-bold text-amber-400">Tirar foto</span>
        </div>

        {/* Right: Rotação */}
        <div className="flex flex-col items-center gap-1.5 min-w-[70px]">
          <button
            type="button"
            onClick={() => setFacingMode(f => (f === 'user' ? 'environment' : 'user'))}
            className="w-14 h-14 rounded-2xl bg-neutral-900/80 border border-white/20 flex items-center justify-center text-white shadow-lg active:scale-90 active:rotate-180 transition-all duration-300"
            title="Rotacionar câmera"
          >
            <RefreshCw className="w-6 h-6 text-white/90" />
          </button>
          <span className="text-xs font-semibold text-white/90">Rotação</span>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// GEMINI LIVE MODE MODAL (USING gemini-3.8-live)
// ==========================================

// ==========================================
// GEMINI LIVE MODE MODAL (DEV LIVE)
// ==========================================

function DevLiveModal() {
  const { geminiLiveOpen, setGeminiLiveOpen } = useApp();
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [volume, setVolume] = useState(0);
  const [frequencyData, setFrequencyData] = useState<number[]>(new Array(10).fill(0));
  const [callState, setCallState] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  const [userTranscript, setUserTranscript] = useState('');
  const [aiSpeechText, setAiSpeechText] = useState('Olá! Estou conectado na chamada Dev Live. Pode falar comigo.');

  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const pauseTimerRef = useRef<any>(null);
  const isSpeakingAiRef = useRef(false);

  // Request voice answer from Gemini and speak aloud
  const askAiReply = async (queryText: string) => {
    if (!queryText.trim() || isSpeakingAiRef.current) return;
    setCallState('thinking');

    try {
      const res = await fetch('/api/live/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: queryText })
      });
      const data = await res.json();
      const reply = data.replyText || 'Estou ouvindo você perfeitamente! Como posso te ajudar agora?';
      
      setAiSpeechText(reply);
      setCallState('speaking');
      isSpeakingAiRef.current = true;

      // Real Speech Synthesis voice out loud
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(reply);
          utterance.lang = 'pt-BR';
          utterance.rate = 1.05;

          const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
          const ptVoice = voices.find(v => v.lang.includes('pt') && (v.name.includes('Google') || v.name.includes('Luciana') || v.name.includes('Antonio') || v.name.includes('Natural')));
          if (ptVoice) utterance.voice = ptVoice;

          utterance.onend = () => {
            isSpeakingAiRef.current = false;
            setCallState('listening');
            setUserTranscript('');
          };
          utterance.onerror = () => {
            isSpeakingAiRef.current = false;
            setCallState('listening');
          };

          window.speechSynthesis.speak(utterance);
        } catch (e) {
          isSpeakingAiRef.current = false;
          setCallState('listening');
        }
      } else {
        isSpeakingAiRef.current = false;
        setCallState('listening');
      }
    } catch (e) {
      console.error(e);
      setCallState('listening');
    }
  };

  useEffect(() => {
    if (!geminiLiveOpen) {
      stopMedia();
      return;
    }

    const startMedia = async () => {
      try {
        if (!navigator?.mediaDevices?.getUserMedia) {
          console.warn('getUserMedia não disponível');
          return;
        }

        const s = await navigator.mediaDevices.getUserMedia({ 
          audio: true, 
          video: cameraOn ? { facingMode } : false 
        });
        setStream(s);
        if (videoRef.current && cameraOn) {
          videoRef.current.srcObject = s;
        }

        // Setup Audio Analyser
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          try {
            audioContextRef.current = new AudioCtx();
            if (audioContextRef.current.state === 'suspended') {
              await audioContextRef.current.resume();
            }

            const source = audioContextRef.current.createMediaStreamSource(s);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 64; 
            source.connect(analyserRef.current);

            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const updateVisuals = () => {
              if (analyserRef.current) {
                analyserRef.current.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((a, b) => a + b, 0);
                const avg = sum / dataArray.length;

                // Strict Noise Gate: Ignore volume below 24
                const realVolume = isMuted ? 0 : (avg > 24 ? avg : 0);
                setVolume(realVolume);
                
                // Map frequency data to bass bars
                const bars = Array.from(dataArray).slice(0, 10).map(v => isMuted ? 0 : (v > 20 ? v : 0));
                setFrequencyData(bars);
                
                // Interrupt AI if user speaks loud enough
                if (realVolume > 35 && isSpeakingAiRef.current) {
                  if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
                    try { window.speechSynthesis.cancel(); } catch (e) {}
                  }
                  isSpeakingAiRef.current = false;
                  setCallState('listening');
                }

                animationFrameRef.current = requestAnimationFrame(updateVisuals);
              }
            };
            updateVisuals();
          } catch (e) {
            console.warn('AudioContext not started:', e);
          }
        }

        // Speech recognition
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          const rec = new SpeechRec();
          rec.lang = 'pt-BR';
          rec.continuous = true;
          rec.interimResults = true;

          rec.onresult = (event: any) => {
            if (isMuted) return;
            let current = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              current += event.results[i][0].transcript;
            }
            if (current.trim()) {
              setUserTranscript(current);

              if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);

              // Wait 1.4s after speaking to respond
              pauseTimerRef.current = setTimeout(() => {
                askAiReply(current);
              }, 1400);
            }
          };

          rec.onerror = (err: any) => {
            console.log('Speech rec notice:', err?.error);
          };

          rec.onend = () => {
            if (geminiLiveOpen && !isMuted) {
              try { rec.start(); } catch (e) {}
            }
          };

          try {
            rec.start();
            recognitionRef.current = rec;
          } catch (e) {}
        }

        // Voice greeting when connecting
        setTimeout(() => {
          if (!isSpeakingAiRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
            try {
              window.speechSynthesis.cancel();
              const welcome = new SpeechSynthesisUtterance('Chamada Dev Live iniciada. Estou ouvindo você.');
              welcome.lang = 'pt-BR';
              welcome.rate = 1.05;
              window.speechSynthesis.speak(welcome);
            } catch (e) {}
          }
        }, 500);

      } catch (err) {
        console.error('Erro ao acessar mídia:', err);
      }
    };
    startMedia();

    return () => {
      stopMedia();
    };
  }, [geminiLiveOpen, cameraOn, facingMode, isMuted]);

  const stopMedia = () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    isSpeakingAiRef.current = false;

    if (stream) {
      try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      setStream(null);
    }
    if (screenStream) {
      try { screenStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      setScreenStream(null);
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close().catch(() => {}); } catch (e) {}
      audioContextRef.current = null;
    }
    if (animationFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      try { cancelAnimationFrame(animationFrameRef.current); } catch (e) {}
      animationFrameRef.current = null;
    }
    setSharingScreen(false);
  };

  const handleScreenShare = async () => {
    if (sharingScreen) {
      if (screenStream) screenStream.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      setSharingScreen(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      setScreenStream(s);
      setSharingScreen(true);
      if (screenRef.current) screenRef.current.srcObject = s;
      s.getVideoTracks()[0].onended = () => {
        setSharingScreen(false);
        setScreenStream(null);
      };
    } catch (err) {
      console.error('Erro ao compartilhar tela:', err);
    }
  };

  if (!geminiLiveOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-neutral-950 flex items-center justify-center overflow-hidden font-sans select-none">
      {/* Background (Camera or Animation) */}
      {cameraOn && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black px-4">
          <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center">
            {/* Background Rings */}
            <div 
              className={`absolute inset-0 rounded-full border transition-transform duration-75 ${callState === 'speaking' ? 'border-blue-500/30 bg-blue-500/10 scale-105' : 'border-emerald-500/10 bg-emerald-500/5'}`}
              style={{ transform: `scale(${1 + volume / 90})` }}
            />
            <div 
              className={`absolute inset-8 rounded-full border transition-transform duration-100 ${callState === 'speaking' ? 'border-blue-500/40 bg-blue-500/15' : 'border-emerald-500/20 bg-emerald-500/10'}`}
              style={{ transform: `scale(${1 + volume / 130})` }}
            />
            
            {/* Visualizer Bars (Grave/Bass) */}
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 px-10">
              {frequencyData.map((v, i) => {
                const simulatedBar = callState === 'speaking' ? Math.floor(Math.sin(Date.now() / 150 + i) * 30 + 35) : v;
                return (
                  <div 
                    key={i} 
                    className={`w-1.5 rounded-full transition-all duration-75 ${callState === 'speaking' ? 'bg-blue-400' : 'bg-emerald-400'}`}
                    style={{ 
                      height: `${Math.max(6, simulatedBar / 2)}px`, 
                      opacity: 0.3 + (simulatedBar / 255) 
                    }}
                  />
                );
              })}
            </div>

            <div className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full border flex items-center justify-center shadow-2xl z-10 transition-all ${
              callState === 'speaking' 
                ? 'bg-neutral-900 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.3)]' 
                : callState === 'thinking'
                ? 'bg-neutral-900 border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.2)]'
                : 'bg-neutral-900 border-neutral-800'
            }`}>
              <PhoneCall className={`w-12 h-12 md:w-16 md:h-16 transition-colors duration-300 ${
                callState === 'speaking' 
                  ? 'text-blue-400 animate-pulse' 
                  : callState === 'thinking'
                  ? 'text-amber-400 animate-bounce'
                  : volume > 10 
                  ? 'text-emerald-400' 
                  : 'text-neutral-600'
              }`} />
            </div>
          </div>
          
          {/* Real-time Subtitles / Transcription */}
          <div className="mt-8 max-w-lg w-full px-4 text-center space-y-3">
             <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                <span className={`w-2 h-2 rounded-full ${
                  callState === 'speaking' ? 'bg-blue-500 animate-pulse' : callState === 'thinking' ? 'bg-amber-500 animate-spin' : 'bg-emerald-500 animate-pulse'
                }`} />
                <span>
                  {callState === 'speaking' ? 'DEV AI FALANDO' : callState === 'thinking' ? 'PROCESSANDO RESPOSTA...' : 'OUVINDO SUA VOZ'}
                </span>
             </div>

             <div className="min-h-[50px] flex items-center justify-center">
               {callState === 'speaking' ? (
                 <p className="text-blue-200 text-sm md:text-base font-semibold leading-relaxed animate-in fade-in">
                   "{aiSpeechText}"
                 </p>
               ) : userTranscript ? (
                 <p className="text-white text-sm md:text-base font-medium leading-relaxed">
                   Você: <span className="italic">"{userTranscript}"</span>
                 </p>
               ) : (
                 <p className="text-neutral-500 text-xs md:text-sm">
                   Fale naturalmente com o microfone ou escolha uma pergunta rápida abaixo:
                 </p>
               )}
             </div>

             {/* Quick Questions Chips */}
             <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
               {[
                 'Como você pode me ajudar?',
                 'Me dê uma dica rápida de código',
                 'O que você consegue criar?'
               ].map((prompt, i) => (
                 <button
                   key={i}
                   onClick={() => {
                     setUserTranscript(prompt);
                     askAiReply(prompt);
                   }}
                   className="px-3 py-1.5 rounded-full bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 text-[11px] text-neutral-300 hover:text-white transition-all active:scale-95"
                 >
                   {prompt}
                 </button>
               ))}
             </div>
          </div>
        </div>
      )}

      {/* Screen Share Mini Popup */}
      {sharingScreen && (
        <div className="absolute top-24 right-4 md:top-8 md:right-8 w-48 md:w-64 aspect-video bg-neutral-900 border-2 border-blue-500 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(59,130,246,0.3)] z-50 animate-in slide-in-from-right duration-500">
           <video ref={screenRef} autoPlay playsInline muted className="w-full h-full object-cover" />
           <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 bg-blue-500 text-white text-[8px] font-black uppercase rounded-lg shadow-lg">
             <div className="w-1 h-1 rounded-full bg-white animate-pulse" />
             LIVE
           </div>
        </div>
      )}

      {/* Top Info */}
      <div className="absolute top-0 left-0 right-0 p-6 md:p-8 z-10 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 p-2 flex items-center justify-center overflow-hidden">
            <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="Dev AI" className="w-full h-full object-cover" />
          </div>
          <div>
            <h3 className="text-white font-black text-base md:text-lg tracking-tight">DEV LIVE</h3>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Chamada de Voz Ativa</p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Island */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 md:gap-3 p-1.5 md:p-2.5 bg-black/50 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-in fade-in slide-in-from-bottom-10 duration-700">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className={`p-3 md:p-4 rounded-full transition-all active:scale-90 ${isMuted ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]' : 'bg-white/10 text-white hover:bg-white/20'}`}
          title={isMuted ? 'Desativar Mudo' : 'Ativar Mudo'}
        >
          {isMuted ? <VolumeX className="w-4 h-4 md:w-5 md:h-5" /> : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
        </button>

        <button
          onClick={() => setCameraOn(!cameraOn)}
          className={`p-3 md:p-4 rounded-full transition-all active:scale-90 ${cameraOn ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-white/10 text-white hover:bg-white/20'}`}
          title={cameraOn ? 'Desligar Câmera' : 'Ligar Câmera'}
        >
          {cameraOn ? <Camera className="w-4 h-4 md:w-5 md:h-5" /> : <Video className="w-4 h-4 md:w-5 md:h-5" />}
        </button>

        {cameraOn && (
          <button
            onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
            className="p-3 md:p-4 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all active:scale-90"
            title="Alternar Câmera"
          >
            <RotateCcw className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        )}

        <button
          onClick={handleScreenShare}
          className={`p-3 md:p-4 rounded-full transition-all active:scale-90 ${sharingScreen ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-white/10 text-white hover:bg-white/20'}`}
          title={sharingScreen ? 'Parar Compartilhamento' : 'Compartilhar Tela'}
        >
          <MonitorUp className="w-4 h-4 md:w-5 md:h-5" />
        </button>

        <div className="w-[1px] h-8 bg-white/10 mx-1" />

        <button
          onClick={() => setGeminiLiveOpen(false)}
          className="p-3 md:p-4 rounded-full bg-red-600 text-white hover:bg-red-500 transition-all shadow-[0_0_30px_rgba(220,38,38,0.5)] flex items-center justify-center group active:scale-90"
          title="Encerrar Dev Live"
        >
          <PhoneOff className="w-4 h-4 md:w-5 md:h-5 group-hover:rotate-12 transition-transform" />
        </button>
      </div>

      {/* Watermark */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 md:left-8 md:translate-x-0 text-[8px] md:text-[10px] font-black text-white/10 uppercase tracking-[0.3em] pointer-events-none whitespace-nowrap">
        Dev AI High Performance Live
      </div>
    </div>
  );
}

// ==========================================
// IMAGE GENERATION MODAL (INPUT DIFERENCIADO & PROPORÇÃO)
// ==========================================

function ImageGenModal({ onGenerate }: { onGenerate: (prompt: string, ratio: string) => void }) {
  const { imageGenModalOpen, setImageGenModalOpen } = useApp();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!imageGenModalOpen) return null;

  const ratios = [
    { id: '1:1', label: 'Quadrado', sub: '1:1', iconClass: 'w-4 h-4 rounded-xs border-2' },
    { id: '16:9', label: 'Paisagem', sub: '16:9', iconClass: 'w-6 h-3.5 rounded-xs border-2' },
    { id: '9:16', label: 'Vertical', sub: '9:16', iconClass: 'w-3.5 h-6 rounded-xs border-2' },
    { id: '4:3', label: 'Padrão', sub: '4:3', iconClass: 'w-5 h-4 rounded-xs border-2' },
    { id: '3:4', label: 'Retrato', sub: '3:4', iconClass: 'w-4 h-5 rounded-xs border-2' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isSubmitting) return;
    setIsSubmitting(true);
    onGenerate(prompt.trim(), aspectRatio);
    setIsSubmitting(false);
    setPrompt('');
    setImageGenModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-[2.5rem] w-full max-w-lg p-6 md:p-8 space-y-6 shadow-2xl relative">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center border border-neutral-200 dark:border-neutral-700">
              <Palette className="w-5 h-5 text-neutral-900 dark:text-neutral-100" />
            </div>
            <div>
              <h3 className="font-bold text-base text-neutral-900 dark:text-neutral-100 tracking-tight">Criar Imagem</h3>
              <p className="text-[11px] text-neutral-500">Gere ilustrações e fotos com inteligência artificial</p>
            </div>
          </div>
          <button
            onClick={() => setImageGenModalOpen(false)}
            className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Input Diferenciado */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
              Descrição da imagem
            </label>
            <div className="relative rounded-2xl p-0.5 bg-gradient-to-b from-neutral-200 to-neutral-100 dark:from-neutral-700 dark:to-neutral-800 focus-within:from-neutral-400 dark:focus-within:from-white transition-all">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: Uma paisagem futurista ao pôr do sol com montanhas neon e reflexo n'água, alta definição, iluminação cinematográfica..."
                className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 rounded-2xl p-4 text-sm focus:outline-none resize-none min-h-[110px] font-sans leading-relaxed shadow-inner"
                autoFocus
              />
            </div>
          </div>

          {/* Seleção de Proporção */}
          <div className="space-y-2.5">
            <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
              Proporção da imagem
            </label>
            <div className="grid grid-cols-5 gap-2">
              {ratios.map((r) => {
                const isSelected = aspectRatio === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setAspectRatio(r.id)}
                    className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all ${
                      isSelected
                        ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-md'
                        : 'border-neutral-200 dark:border-neutral-800/80 bg-neutral-50 dark:bg-neutral-950/60 text-neutral-500 hover:border-neutral-400 dark:hover:border-neutral-700'
                    }`}
                  >
                    <div className="h-7 flex items-center justify-center mb-1.5">
                      <div className={`${r.iconClass} ${isSelected ? 'border-neutral-900 dark:border-white' : 'border-neutral-400 dark:border-neutral-600'}`} />
                    </div>
                    <span className="text-[11px] font-bold leading-none">{r.sub}</span>
                    <span className="text-[9px] opacity-70 mt-1 truncate max-w-full">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setImageGenModalOpen(false)}
              className="px-4 py-2.5 rounded-xl text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!prompt.trim() || isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 font-bold text-xs shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 transition-all"
            >
              <Palette className="w-4 h-4" />
              <span>{isSubmitting ? 'Gerando...' : 'Gerar Imagem'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// PASTE CHOICE MODAL (EXACT SCREENSHOT SPEC)
// ==========================================

function PasteChoiceModal({
  modalData,
  onClose,
  onChooseText,
  onChooseFile
}: {
  modalData: { text?: string; files?: File[] } | null;
  onClose: () => void;
  onChooseText: (text: string) => void;
  onChooseFile: (text?: string, files?: File[]) => void;
}) {
  const [rememberChoice, setRememberChoice] = useState(() => {
    return Boolean(localStorage.getItem('DEV_AI_REMEMBER_PASTE'));
  });

  if (!modalData) return null;

  const handleActionFile = () => {
    if (rememberChoice) {
      localStorage.setItem('DEV_AI_REMEMBER_PASTE', 'file');
    }
    onChooseFile(modalData.text, modalData.files);
    onClose();
  };

  const handleActionText = () => {
    if (rememberChoice) {
      localStorage.setItem('DEV_AI_REMEMBER_PASTE', 'text');
    }
    if (modalData.text) onChooseText(modalData.text);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60000] bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200 font-sans select-none">
      <div className="bg-[#181818] border-t border-neutral-800 sm:border rounded-t-[32px] sm:rounded-[32px] w-full max-w-md p-6 sm:p-8 space-y-6 shadow-2xl relative text-white">
        {/* Drag handle pill matching screenshot */}
        <div className="w-10 h-1.5 bg-neutral-600/80 rounded-full mx-auto mb-2" />

        <div className="space-y-2 text-left">
          <h3 className="text-xl font-bold text-white tracking-tight">Texto grande</h3>
          <p className="text-sm text-neutral-300 font-normal leading-relaxed">
            O texto que está colando é um pouco grande. Gostaria de anexá-lo como um arquivo?
          </p>
        </div>

        <div className="space-y-3.5 pt-1">
          {/* Main White Pill Button matching screenshot */}
          <button
            type="button"
            onClick={handleActionFile}
            className="w-full bg-white hover:bg-neutral-200 active:scale-[0.98] text-neutral-950 font-semibold text-base py-4 rounded-full transition-all shadow-md text-center"
          >
            Anexar como Arquivo
          </button>

          {/* Secondary Dark Grey Pill Button matching screenshot */}
          <button
            type="button"
            onClick={handleActionText}
            className="w-full bg-[#2c2c2c] hover:bg-[#3c3c3c] active:scale-[0.98] text-white font-semibold text-base py-4 rounded-full transition-all text-center"
          >
            Colar como texto
          </button>
        </div>

        {/* Bottom Toggle Row matching screenshot: Lembrar minha escolha */}
        <div className="flex items-center justify-between pt-4 border-t border-neutral-800/80">
          <span className="text-sm font-medium text-neutral-300">Lembrar minha escolha</span>
          <button
            type="button"
            onClick={() => {
              const next = !rememberChoice;
              setRememberChoice(next);
              if (!next) localStorage.removeItem('DEV_AI_REMEMBER_PASTE');
            }}
            className={`w-12 h-7 rounded-full p-1 transition-colors duration-200 flex items-center ${
              rememberChoice ? 'bg-white justify-end' : 'bg-[#333333] justify-start'
            }`}
          >
            <div className={`w-5 h-5 rounded-full transition-all ${rememberChoice ? 'bg-black' : 'bg-neutral-400'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// CHAT INPUT
// ==========================================

function getModelDisplayName(modelName: string): string {
  const map: Record<string, string> = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-pro': 'Gemini 3.5 Pro',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gemini-3.1-flash': 'Gemini 3.1 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  };
  if (map[modelName]) return map[modelName];
  return (modelName || '')
    .replace('gemini-', 'Gemini ')
    .replace('-preview', '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function ChatInput({
  onSendMessage,
  isGenerating,
  onCancel,
  inputText,
  setInputText,
  editingMessage,
  onCancelEdit,
  pendingAttachments,
  setPendingAttachments
}: {
  onSendMessage: (text: string, atts?: any[]) => void;
  isGenerating: boolean;
  onCancel: () => void;
  inputText: string;
  setInputText: (t: string) => void;
  editingMessage?: { index: number; content: string } | null;
  onCancelEdit?: () => void;
  pendingAttachments?: any[];
  setPendingAttachments?: (atts: any[]) => void;
}) {
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [waveBars, setWaveBars] = useState<number[]>(Array(24).fill(4));
  const [pasteModalData, setPasteModalData] = useState<{ text?: string; files?: File[] } | null>(null);
  const { settings, setModelSelectorOpen, setExpandedEditorOpen, setCameraModalOpen, setImageGenModalOpen, showToast, activeChat, setSelectedMediaPreview } = useApp();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  const isViewer = activeChat?.myRole === 'viewer';

  // Sync external pendingAttachments (e.g. captured camera photos) into attachments above input
  useEffect(() => {
    if (pendingAttachments && pendingAttachments.length > 0) {
      setAttachments(prev => [...prev, ...pendingAttachments]);
      if (setPendingAttachments) setPendingAttachments([]);
    }
  }, [pendingAttachments, setPendingAttachments]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollH, 120)}px`;
    }
  }, [inputText]);

  // Clean up audio & speech streams on unmount
  useEffect(() => {
    return () => {
      stopVoiceRecording();
    };
  }, []);

  const handleChooseText = (text: string) => {
    setInputText(inputText ? `${inputText}\n${text}` : text);
  };

  const handleChooseFile = (text?: string, files?: File[]) => {
    const newAtts: any[] = [];
    if (files && files.length > 0) {
      files.forEach(f => {
        newAtts.push({
          id: 'att_' + Date.now() + Math.random().toString(36).substring(7),
          name: f.name || `arquivo_${Date.now()}`,
          size: `${(f.size / 1024).toFixed(1)} KB`,
          type: f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'doc',
          url: URL.createObjectURL(f)
        });
      });
    }
    if (text && text.trim()) {
      const blob = new Blob([text], { type: 'text/plain' });
      newAtts.push({
        id: 'att_' + Date.now(),
        name: `texto_colado_${Date.now()}.txt`,
        size: `${(blob.size / 1024).toFixed(1)} KB`,
        type: 'doc',
        url: URL.createObjectURL(blob)
      });
    }
    if (newAtts.length > 0) {
      setAttachments(prev => [...prev, ...newAtts]);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isViewer) {
      showToast('Você tem permissão apenas de visualizador nesta conversa.');
      return;
    }
    if (!inputText.trim() && attachments.length === 0) return;
    onSendMessage(inputText.trim(), attachments);
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

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        const audioCtx = new AudioCtxClass();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let lastShift = Date.now();

        const updateWave = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);

          // Calculate bass energy (first 6 frequency bins)
          let bassSum = 0;
          for (let i = 0; i < 6; i++) {
            bassSum += dataArray[i];
          }
          const bassVal = bassSum / 6;

          // Calculate overall volume
          let volSum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            volSum += dataArray[i];
          }
          const volVal = volSum / dataArray.length;

          const now = Date.now();
          if (now - lastShift > 40) { // Shift wave to the right every 40ms
            lastShift = now;
            // Scale bar height according to bass & volume (range: 4px to 32px)
            const bassHeight = Math.max(4, Math.min(32, (bassVal / 255) * 28 + (volVal / 255) * 8 + Math.random() * 3));
            setWaveBars(prev => [bassHeight, ...prev.slice(0, 23)]); // Flowing to the right!
          }

          animFrameRef.current = requestAnimationFrame(updateWave);
        };
        updateWave();
      }
    } catch (e) {
      console.warn('Microphone stream access error:', e);
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        const recognition = new SpeechRec();
        recognitionRef.current = recognition;
        recognition.lang = 'pt-BR';
        recognition.interimResults = true;
        recognition.continuous = true;

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript.trim()) {
            setInputText(transcript.trim());
          }
        };

        recognition.onerror = () => {
          stopVoiceRecording();
        };

        recognition.onend = () => {
          stopVoiceRecording();
        };

        recognition.start();
      } catch (e) {
        console.warn('Speech recognition start error:', e);
      }
    }

    setIsRecordingAudio(true);
    showToast('Ouvindo... Fale com o microfone.');
  };

  const stopVoiceRecording = () => {
    setIsRecordingAudio(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    analyserRef.current = null;
    setWaveBars(Array(24).fill(4));
  };

  const handleMicClick = () => {
    if (isRecordingAudio) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  };

  return (
    <div className="p-3 md:p-4 bg-transparent">
      <PasteChoiceModal
        modalData={pasteModalData}
        onClose={() => setPasteModalData(null)}
        onChooseText={handleChooseText}
        onChooseFile={handleChooseFile}
      />
      <div className="max-w-2xl mx-auto">
        {/* Banner Editando mensagem */}
        {editingMessage && (
          <div className="flex items-center justify-between px-4 py-2 mb-2 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-2xl text-xs animate-in fade-in duration-200 shadow-sm">
            <div className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
              <Edit2 className="w-4 h-4 text-emerald-500" />
              <span className="font-bold">Editando mensagem</span>
            </div>
            <button
              type="button"
              onClick={onCancelEdit}
              className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              title="Cancelar edição"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isViewer && (
          <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-600 dark:text-amber-400">
            <Eye className="w-4 h-4 shrink-0" />
            <span>Modo somente leitura (Você tem permissão de Visualizador nesta conversa).</span>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1 scrollbar-none">
            {attachments.map((att) => (
              <div 
                key={att.id} 
                onClick={() => setSelectedMediaPreview(att)}
                className="relative bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300 shadow-sm cursor-pointer hover:border-neutral-400 transition-all"
              >
                {att.type === 'image' ? (
                  <img src={att.url} alt="thumb" className="w-8 h-8 rounded object-cover" />
                ) : att.type === 'video' ? (
                  <Video className="w-5 h-5 text-neutral-400" />
                ) : (
                  <File className="w-5 h-5 text-neutral-400" />
                )}
                <div className="max-w-[100px] truncate">
                  <div className="truncate font-medium">{att.name}</div>
                  <div className="text-[10px] text-neutral-400">{att.size}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAttachments(prev => prev.filter((x: any) => x.id !== att.id));
                  }}
                  className="p-1 hover:text-red-500 text-neutral-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Live Audio Wave Visualizer bar moving right with voice bass */}
        {isRecordingAudio && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-neutral-900 border border-emerald-500/40 rounded-2xl mb-2.5 animate-in fade-in duration-300 shadow-xl">
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-[11px] font-extrabold text-emerald-400 uppercase tracking-widest">Ouvindo...</span>
            </div>

            {/* Soundwave bars moving to the right according to bass volume */}
            <div className="flex-1 flex items-center justify-center gap-1 h-8 overflow-hidden px-2">
              {waveBars.map((h, idx) => (
                <div
                  key={idx}
                  className="w-1.5 rounded-full transition-all duration-75"
                  style={{
                    height: `${h}px`,
                    backgroundColor: idx === 0 ? '#10b981' : idx < 6 ? '#34d399' : idx < 14 ? '#60a5fa' : '#a855f7',
                    opacity: Math.max(0.35, 1 - (idx * 0.025))
                  }}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={stopVoiceRecording}
              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs rounded-xl transition-all shrink-0 shadow-md active:scale-95"
            >
              Concluir
            </button>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="relative bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 rounded-3xl p-3 shadow-lg transition-all focus-within:border-neutral-400 dark:focus-within:border-neutral-700"
        >
          <div className="relative flex items-start">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isViewer}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              onPaste={(e) => {
                const pastedText = e.clipboardData.getData('text');
                const pastedFiles = Array.from(e.clipboardData.files || []);
                if (pastedFiles.length > 0 || (pastedText && pastedText.length > 250)) {
                  e.preventDefault();
                  setPasteModalData({ text: pastedText, files: pastedFiles });
                }
              }}
              placeholder={isViewer ? 'Apenas leitura (Visualizador)...' : isRecordingAudio ? 'Ouvindo áudio... Fale agora' : 'Escreva uma mensagem...'}
              className="w-full bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 px-3 py-2 text-sm focus:outline-none resize-none overflow-y-auto max-h-32 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontWeight: settings.boldFont ? 'bold' : '500' }}
            />

            <button
              type="button"
              disabled={isViewer}
              onClick={() => setExpandedEditorOpen(true)}
              className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors shrink-0 disabled:opacity-40"
              title="Expandir editor"
            >
              <Maximize2 className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Action Row WITHOUT any horizontal traversing line (border-t removed) */}
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  disabled={isViewer}
                  onClick={() => setAttachmentMenuOpen(!attachmentMenuOpen)}
                  className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors disabled:opacity-40"
                  title="Anexar arquivos"
                >
                  <Plus className="w-5 h-5" />
                </button>

                {attachmentMenuOpen && (
                  <div className="absolute left-0 bottom-12 w-48 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl py-2 z-40 text-xs space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setImageGenModalOpen(true);
                        setAttachmentMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-white hover:bg-neutral-800 transition-colors"
                    >
                      <Sparkles className="w-4 h-4 text-white" />
                      <span className="text-white font-medium">Criar Imagem</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'image/*,video/*';
                          fileInputRef.current.click();
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-white hover:bg-neutral-800 transition-colors"
                    >
                      <Image className="w-4 h-4 text-white" />
                      <span className="text-white font-medium">Fotos e Vídeos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = '.pdf,.txt,.docx,.xlsx,.csv,.json';
                          fileInputRef.current.click();
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-white hover:bg-neutral-800 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-white" />
                      <span className="text-white font-medium">Arquivos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraModalOpen(true);
                        setAttachmentMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-white hover:bg-neutral-800 transition-colors"
                    >
                      <Camera className="w-4 h-4 text-white" />
                      <span className="text-white font-medium">Câmera</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Botão de Modelo com nome formatado e bonito */}
              <button
                type="button"
                onClick={() => setModelSelectorOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-200/80 dark:bg-neutral-800 border border-neutral-300/60 dark:border-neutral-700/60 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors shadow-xs"
              >
                <div className="w-4 h-4 rounded overflow-hidden flex items-center justify-center bg-white dark:bg-neutral-900 shrink-0">
                  <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="logo" className="w-full h-full object-cover" />
                </div>
                <span className="truncate max-w-[130px] font-medium">{getModelDisplayName(settings.selectedModel)}</span>
                <ChevronRight className="w-3 h-3 text-neutral-500 rotate-90 shrink-0" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isViewer}
                onClick={handleMicClick}
                className={`p-2 rounded-full transition-colors disabled:opacity-40 ${
                  isRecordingAudio ? 'bg-red-500 text-white animate-pulse shadow-lg ring-2 ring-emerald-400' : 'text-neutral-500 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-800'
                }`}
                title="Microfone"
              >
                <Mic className="w-5 h-5" />
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="p-2.5 bg-neutral-900 dark:bg-neutral-800 hover:bg-neutral-800 dark:hover:bg-neutral-700 text-white rounded-xl shadow-md transition-colors border border-neutral-700 flex items-center justify-center"
                  title="Interromper geração"
                >
                  <Square className="w-4 h-4 fill-current text-white" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isViewer || (!inputText.trim() && attachments.length === 0)}
                  className={`p-2.5 rounded-full text-white shadow-md transition-all ${
                    !isViewer && (inputText.trim() || attachments.length > 0)
                      ? 'bg-neutral-950 hover:bg-neutral-800'
                      : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed'
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
    currentUser, onlineCount, loginWithGoogle, showToast
  } = useApp();

  const [activeTab, setActiveTab] = useState<'geral' | 'ia' | 'voz' | 'conta' | 'privacidade' | 'notificacoes' | 'lixeira' | null>(null);
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

  const tabs = [
    { id: 'geral', label: 'Aparência', icon: Sun, desc: 'Tema, fontes e visual' },
    { id: 'ia', label: 'Chat e IA', icon: MessageSquare, desc: 'Modelos e comportamento' },
    { id: 'voz', label: 'Áudio e Voz', icon: Volume2, desc: 'TTS e comandos de voz' },
    { id: 'conta', label: 'Minha Conta', icon: User, desc: 'Perfil e sincronização' },
    { id: 'privacidade', label: 'Privacidade', icon: Shield, desc: 'Segurança e dados' },
    { id: 'notificacoes', label: 'Notificações', icon: Radio, desc: 'Alertas e sons' },
    { id: 'lixeira', label: 'Lixeira', icon: Trash2, desc: 'Chats excluídos' },
  ];

  const renderContent = () => {
    if (!activeTab) return null;

    switch (activeTab) {
      case 'geral':
        return (
          <div className="space-y-8 animate-in slide-in-from-right duration-300">
            <section className="space-y-4">
              <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Tema da Interface</h5>
              <div className="grid grid-cols-3 gap-3">
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
                      className={`flex flex-col items-center gap-3 p-5 rounded-3xl border-2 transition-all ${
                        settings.theme === t.id
                          ? 'border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-900'
                          : 'border-neutral-100 dark:border-neutral-900 hover:border-neutral-200 dark:hover:border-neutral-800'
                      }`}
                    >
                      <Icon className={`w-6 h-6 ${settings.theme === t.id ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'}`} />
                      <span className={`text-xs font-bold ${settings.theme === t.id ? 'text-neutral-900 dark:text-white' : 'text-neutral-500'}`}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4">
              <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Acessibilidade</h5>
              <div className="p-1 rounded-[1.5rem] bg-neutral-100 dark:bg-neutral-900/50">
                <div className="flex items-center justify-between p-4 bg-white dark:bg-neutral-950 rounded-[1.25rem] border border-neutral-200 dark:border-neutral-900">
                  <div>
                    <div className="font-bold text-sm text-neutral-900 dark:text-white">Fonte em Negrito</div>
                    <p className="text-[10px] text-neutral-500">Aumentar o contraste do texto em toda a aplicação.</p>
                  </div>
                  <button onClick={() => toggle('boldFont')} className={`w-12 h-6 rounded-full p-1 transition-all ${settings.boldFont ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-800'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all ${settings.boldFont ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </section>
          </div>
        );
      case 'ia':
        return (
          <div className="space-y-8 animate-in slide-in-from-right duration-300">
            <section className="space-y-4">
              <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Modelo Padrão</h5>
              <div className="space-y-2">
                {availableModels.slice(0, 5).map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setSettings({ ...settings, selectedModel: m.name })}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                      settings.selectedModel === m.name
                        ? 'border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-900'
                        : 'border-neutral-100 dark:border-neutral-900 hover:border-neutral-200 dark:hover:border-neutral-800'
                    }`}
                  >
                    <div className="text-left min-w-0 flex-1">
                      <div className="font-bold text-sm text-neutral-900 dark:text-white truncate">{m.displayName}</div>
                      <div className="text-[10px] text-neutral-500 truncate">{m.description}</div>
                    </div>
                    {settings.selectedModel === m.name && <Check className="w-5 h-5 text-emerald-500 shrink-0 ml-2" />}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Funcionalidades Smart</h5>
              {[
                { key: 'searchWebEnabled', title: 'Pesquisa Web', sub: 'Realizar buscas em tempo real no Google Search.', icon: Search },
                { key: 'codeWrapLines', title: 'Quebra de Código', sub: 'Ajustar linhas longas de código à largura da tela.', icon: Code },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between p-4 rounded-2xl border border-neutral-200 dark:border-neutral-900">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-900 text-neutral-500">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-neutral-900 dark:text-white">{item.title}</div>
                      <p className="text-[10px] text-neutral-500">{item.sub}</p>
                    </div>
                  </div>
                  <button onClick={() => toggle(item.key)} className={`w-12 h-6 rounded-full p-1 transition-all ${settings[item.key] ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-800'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all ${settings[item.key] ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        );
      case 'voz':
        return (
          <div className="space-y-8 animate-in slide-in-from-right duration-300">
            <section className="space-y-4">
               <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Configuração de Voz</h5>
               {[
                { key: 'realVoiceAudio', title: 'Resposta em Áudio (TTS)', sub: 'A IA falará as respostas automaticamente.', icon: Volume2 },
                { key: 'maleVoice', title: 'Voz Masculina', sub: 'Usar timbre masculino para as respostas.', icon: User },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between p-4 rounded-2xl border border-neutral-200 dark:border-neutral-900">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-900 text-neutral-500">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-neutral-900 dark:text-white">{item.title}</div>
                      <p className="text-[10px] text-neutral-500">{item.sub}</p>
                    </div>
                  </div>
                  <button onClick={() => toggle(item.key)} className={`w-12 h-6 rounded-full p-1 transition-all ${settings[item.key] ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-800'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all ${settings[item.key] ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        );
      case 'conta':
        return (
          <div className="space-y-8 animate-in slide-in-from-right duration-300">
            {currentUser ? (
              <div className="space-y-6">
                <section className="p-6 rounded-3xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <img src={currentUser.photoURL || ''} alt="User" className="w-16 h-16 rounded-2xl object-cover border-2 border-white dark:border-neutral-800 shadow-xl shrink-0" />
                    <div className="min-w-0">
                      <h6 className="font-black text-lg text-neutral-900 dark:text-white truncate">{currentUser.displayName || 'Usuário'}</h6>
                      <p className="text-xs text-neutral-500 truncate">{currentUser.email}</p>
                    </div>
                  </div>
                </section>
                <button onClick={() => { auth.signOut(); setSettingsOpen(false); }} className="w-full py-4 rounded-2xl bg-red-500/10 text-red-500 text-xs font-black hover:bg-red-500 hover:text-white transition-all">ENCERRAR SESSÃO</button>

                <section className="space-y-2">
                   <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest pl-1">Identificador Único (UID)</h5>
                   <div className="flex items-center justify-between p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-950 font-mono text-[10px] text-neutral-500">
                     <span className="truncate mr-2">{currentUser.uid}</span>
                     <button onClick={() => { navigator.clipboard.writeText(currentUser.uid); showToast('UID copiado!'); }} className="p-2 hover:bg-neutral-200 dark:hover:bg-neutral-900 rounded-lg shrink-0"><Copy className="w-4 h-4" /></button>
                   </div>
                </section>
              </div>
            ) : (
              <div className="p-12 text-center space-y-4">
                <User className="w-12 h-12 mx-auto text-neutral-300" />
                <h6 className="font-bold text-neutral-900 dark:text-white">Não autenticado</h6>
                <button onClick={loginWithGoogle} className="px-8 py-3 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 font-black text-sm">ENTRAR COM GOOGLE</button>
              </div>
            )}
          </div>
        );
      case 'privacidade':
        return (
          <div className="space-y-8 animate-in slide-in-from-right duration-300">
             <section className="space-y-4">
               <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Sincronização Cloud</h5>
               <div className="p-6 rounded-3xl bg-neutral-900 text-white flex items-center justify-between shadow-xl">
                 <div className="flex items-center gap-4">
                   <HardDrive className="w-6 h-6 text-emerald-400" />
                   <div>
                     <div className="font-bold">Firestore Sincronizado</div>
                     <p className="text-[10px] text-neutral-400">Seu histórico está seguro nos servidores da Google.</p>
                   </div>
                 </div>
                 <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-bold">ATIVO</span>
               </div>
             </section>

             <section className="space-y-4">
               <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Segurança</h5>
               <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <Lock className="w-5 h-5 text-neutral-400" />
                   <div className="font-bold text-sm text-neutral-900 dark:text-white">Modo Anônimo</div>
                 </div>
                 <button onClick={() => toggle('incognito')} className={`w-12 h-6 rounded-full p-1 transition-all ${settings.incognito ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-800'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all ${settings.incognito ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
               </div>
             </section>
          </div>
        );
      case 'notificacoes':
        return (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <section className="space-y-4">
              <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Preferências de Alerta</h5>
              {[
                { key: 'notifSound', title: 'Efeito Sonoro', sub: 'Tocar som ao receber nova mensagem.', icon: Volume2 },
                { key: 'notifBrowser', title: 'Notificações de Navegador', sub: 'Exibir banners do sistema quando em segundo plano.', icon: Radio },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between p-4 rounded-2xl border border-neutral-200 dark:border-neutral-900">
                  <div className="flex items-center gap-4">
                    <item.icon className="w-5 h-5 text-neutral-400" />
                    <div>
                      <div className="font-bold text-sm text-neutral-900 dark:text-white">{item.title}</div>
                      <p className="text-[10px] text-neutral-500">{item.sub}</p>
                    </div>
                  </div>
                  <button onClick={() => toggle(item.key)} className={`w-12 h-6 rounded-full p-1 transition-all ${settings[item.key] ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-800'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all ${settings[item.key] ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        );
      case 'lixeira':
        return (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between">
               <h5 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Gerenciar Itens Excluídos</h5>
               {trashedChats.length > 0 && (
                 <button onClick={emptyTrash} className="text-[10px] font-black text-red-500 hover:underline">LIMPAR TUDO</button>
               )}
            </div>

            {trashedChats.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-neutral-200 dark:border-neutral-900 rounded-[2rem] text-neutral-400">
                Sua lixeira está limpa.
              </div>
            ) : (
              <div className="space-y-3">
                {trashedChats.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <span className="font-bold text-neutral-900 dark:text-neutral-100 truncate pr-4">{c.title}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => restoreFromTrash(c.id)} className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"><ArrowUpRight className="w-4 h-4" /></button>
                      <button onClick={() => permanentlyDelete(c.id)} className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center overflow-hidden">
      <div className="bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-900 w-full h-full md:h-[85vh] md:max-w-4xl md:rounded-[2rem] md:border md:flex overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.3)] flex flex-col md:flex-row">
        
        {/* Desktop Sidebar / Mobile List */}
        <div className={`w-full md:w-64 border-r border-neutral-200 dark:border-neutral-900 bg-neutral-50 dark:bg-neutral-950/50 flex flex-col shrink-0 ${activeTab && 'hidden md:flex'}`}>
          <div className="p-6 md:p-8 flex items-center justify-between">
            <div>
              <h3 className="font-black text-xl text-neutral-900 dark:text-white tracking-tighter">CONFIGURAÇÕES</h3>
              <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mt-1">Plataforma Dev AI</p>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="md:hidden p-2 text-neutral-500">
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-left transition-all ${
                    activeTab === tab.id
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 shadow-lg'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl border transition-colors ${activeTab === tab.id ? 'bg-white/10 border-white/20' : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black tracking-tight">{tab.label}</div>
                    <div className={`text-[10px] font-bold uppercase opacity-60 truncate ${activeTab === tab.id ? 'text-white' : 'text-neutral-500'}`}>{tab.desc}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="p-8 border-t border-neutral-200 dark:border-neutral-900 hidden md:block">
             <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono">
               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
               <span>{onlineCount} USUÁRIOS ONLINE</span>
             </div>
          </div>
        </div>

        {/* Content Area */}
        <div className={`flex-1 flex flex-col bg-white dark:bg-neutral-950 min-w-0 ${!activeTab && 'hidden md:flex'}`}>
          <div className="flex items-center justify-between p-6 border-b border-neutral-200 dark:border-neutral-900">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setActiveTab(null)} 
                className="md:hidden p-2 -ml-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-900 dark:text-white"
              >
                <ChevronRight className="w-6 h-6 rotate-180" />
              </button>
              <h4 className="font-black text-neutral-900 dark:text-white uppercase tracking-widest text-sm">{activeTab || 'Detalhes'}</h4>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-500 transition-colors">
              <X className="w-6 h-6 md:w-5 md:h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-10 scrollbar-thin">
            {activeTab ? renderContent() : (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-40">
                <div className="w-24 h-24 rounded-full border-4 border-dashed border-neutral-400 flex items-center justify-center">
                   <Settings className="w-10 h-10" />
                </div>
                <div>
                  <h5 className="text-lg font-black text-neutral-900 dark:text-white tracking-tighter">CONFIGURAÇÕES DO SISTEMA</h5>
                  <p className="text-xs font-bold text-neutral-500 uppercase tracking-widest mt-1">Selecione uma categoria para começar</p>
                </div>
              </div>
            )}
          </div>
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
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
        <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100">Renomear Conversa</h3>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setRenameModalData(null)}
            className="px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 text-xs font-semibold"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              renameChat(renameModalData.id, title);
              setRenameModalData(null);
            }}
            className="px-4 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
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
    <div className="fixed inset-0 z-[60] bg-white dark:bg-neutral-950 flex flex-col p-4 animate-fadeIn">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800">
        <span className="font-semibold text-sm text-neutral-500 dark:text-neutral-300">Editor Expandido</span>
        <button
          onClick={() => setExpandedEditorOpen(false)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800"
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
          className="w-full h-full bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 text-base focus:outline-none resize-none font-sans leading-relaxed"
          autoFocus
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
        <button
          onClick={() => {
            onSend();
            setExpandedEditorOpen(false);
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-900 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-neutral-950 font-bold text-sm shadow-lg transition-all"
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
  const [activeCategory, setActiveCategory] = useState<string>('Todos');

  const models = [
    { name: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', category: 'Flash', badge: 'FLASH', description: 'Última geração topo de linha com raciocínio rápido e multimodalidade' },
    { name: 'gemini-3.5-pro', displayName: 'Gemini 3.5 Pro', category: 'Pro', badge: 'PRO', description: 'Raciocínio complexo, lógica profunda e programação avançada' },
    { name: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', category: 'Flash', badge: 'FLASH', description: 'Velocidade máxima com alta inteligência para o dia a dia' },
    { name: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', category: 'Lite', badge: 'LITE', description: 'Ultrarrápido, leve e econômico com menor consumo' },
    { name: 'gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', category: 'Pro', badge: 'PRO', description: 'Capacidade analítica avançada e pensamento estruturado' },
    { name: 'gemini-3.1-flash', displayName: 'Gemini 3.1 Flash', category: 'Flash', badge: 'FLASH', description: 'Modelo ágil e balanceado para conversação rápida' },
    { name: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', category: 'Lite', badge: 'LITE', description: 'Ultra leve, resposta imediata e baixa latência' }
  ];

  if (!modelSelectorOpen) return null;

  const filtered = activeCategory === 'Todos' ? models : models.filter(m => m.category === activeCategory);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-4 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded overflow-hidden flex items-center justify-center bg-neutral-100 dark:bg-neutral-800">
              <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-xs text-neutral-900 dark:text-neutral-200">Selecionar Modelo Gemini</span>
          </div>
          <button onClick={() => setModelSelectorOpen(false)} className="p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Categorias de Filtro: Todos, Lite, Pro, Flash */}
        <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800/60 rounded-xl text-xs">
          {['Todos', 'Lite', 'Pro', 'Flash'].map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all ${
                activeCategory === cat
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-neutral-200 dark:scrollbar-thumb-neutral-800">
          {filtered.map((m) => {
            const isSelected = settings.selectedModel === m.name;
            const badgeStyle = m.badge === 'PRO'
              ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
              : m.badge === 'LITE'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';

            return (
              <button
                key={m.name}
                onClick={() => {
                  setSettings({ ...settings, selectedModel: m.name });
                  setModelSelectorOpen(false);
                }}
                className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                  isSelected
                    ? 'bg-neutral-100 dark:bg-neutral-950 border-neutral-900 dark:border-white shadow-md'
                    : 'bg-neutral-50 dark:bg-neutral-950/50 border-neutral-200 dark:border-neutral-800/80 hover:border-neutral-400 dark:hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-neutral-900 dark:text-neutral-100">{m.displayName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${badgeStyle}`}>
                    {m.badge}
                  </span>
                </div>
                <p className="text-[11px] text-neutral-500 mt-1 leading-tight">{m.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Share Modal com Compartilhamento por ID de Usuário e Permissões
function ShareModal() {
  const {
    shareModalOpen, setShareModalOpen, showToast, activeChat,
    myUserId, shareChatWithUser, updateSharedUserRole, removeSharedUser
  } = useApp();

  const [targetUserId, setTargetUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'viewer' | 'editor' | 'admin'>('editor');

  if (!shareModalOpen || !activeChat) return null;

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId.trim()) return;
    if (targetUserId.trim() === myUserId) {
      showToast('Você já é o proprietário desta conversa.');
      return;
    }
    const success = shareChatWithUser(activeChat.id, targetUserId.trim(), selectedRole);
    if (success) {
      showToast(`Chat compartilhado com ${targetUserId.trim()}!`);
      setTargetUserId('');
    }
  };

  const sharedUsers = Array.isArray(activeChat.sharedUsers) ? activeChat.sharedUsers : [];

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-[2.5rem] w-full max-w-lg p-6 md:p-8 space-y-6 shadow-[0_0_60px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shadow-xs">
              <UserCheck className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="font-bold text-base text-neutral-900 dark:text-white tracking-tight">Compartilhar Conversa</h3>
              <p className="text-[11px] text-neutral-500">Conceda acesso por ID de usuário com permissões personalizadas</p>
            </div>
          </div>
          <button
            onClick={() => setShareModalOpen(false)}
            className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Seu ID de Usuário */}
        <div className="p-3 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-2xl flex items-center justify-between text-xs">
          <div>
            <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider block">Seu ID de Usuário</span>
            <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">{myUserId}</span>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(myUserId);
              showToast('Seu ID copiado!');
            }}
            className="px-3 py-1.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 font-bold text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copiar meu ID</span>
          </button>
        </div>

        {/* Formulário para Adicionar Usuário e Escolher Permissão */}
        <form onSubmit={handleAddUser} className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
              ID do Usuário a convidar
            </label>
            <input
              type="text"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="Digite o ID do usuário (ex: user_8f3a9b)"
              className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-800 rounded-2xl px-4 py-3 text-xs focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
              Nível de Permissão
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'viewer', title: 'Somente ver', desc: 'Apenas leitura' },
                { id: 'editor', title: 'Editor', desc: 'Lê e envia msg' },
                { id: 'admin', title: 'Administrador', desc: 'Envia e compartilha' }
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedRole(opt.id as any)}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    selectedRole === opt.id
                      ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-sm'
                      : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/60 text-neutral-500 hover:border-neutral-300'
                  }`}
                >
                  <div className="font-bold text-xs">{opt.title}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!targetUserId.trim()}
            className="w-full py-3 bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 font-bold text-xs rounded-2xl shadow-lg hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>Adicionar Acesso</span>
          </button>
        </form>

        {/* Lista de Usuários com Acesso nesta conversa */}
        <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
            Usuários com Acesso ({sharedUsers.length})
          </div>

          {sharedUsers.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-400 bg-neutral-50 dark:bg-neutral-950/50 rounded-2xl border border-neutral-100 dark:border-neutral-800/80">
              Nenhum usuário compartilhado ainda. Adicione pelo ID acima.
            </div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {sharedUsers.map((u: any) => (
                <div key={u.userId} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-2xl text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 flex items-center justify-center shrink-0">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                    </div>
                    <span className="font-mono text-neutral-900 dark:text-neutral-200 truncate">{u.userId}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={u.role}
                      onChange={(e) => updateSharedUserRole(activeChat.id, u.userId, e.target.value as any)}
                      className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 text-[11px] font-semibold rounded-lg px-2 py-1 focus:outline-none"
                    >
                      <option value="viewer">Somente ver</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Administrador</option>
                    </select>

                    <button
                      onClick={() => removeSharedUser(activeChat.id, u.userId)}
                      className="p-1.5 text-neutral-400 hover:text-red-500 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                      title="Remover acesso"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button 
          onClick={() => setShareModalOpen(false)}
          className="w-full py-2.5 text-[11px] font-bold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 tracking-wider text-center"
        >
          CONCLUÍDO
        </button>
      </div>
    </div>
  );
}

function ToastNotification({ message: _message }: { message: string | null }) {
  // User explicitly asked to remove all notifications from the app
  return null;
}

// ==========================================
// MAIN APP CONTENT
// ==========================================

function AppContent() {
  const {
    chats, setChats, activeChatId, activeChat, createNewChat,
    setSidebarOpen, setShareModalOpen, isGenerating, setIsGenerating,
    setGenerationState, showToast, toastMessage, previewHtmlCode, setPreviewHtmlCode,
    settings, setGeminiLiveOpen, cameraModalOpen, setCameraModalOpen,
    myUserId
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [editingMessage, setEditingMessage] = useState<{ index: number; content: string } | null>(null);

  const [pendingAttachments, setPendingAttachments] = useState<any[]>([]);

  const handleEditUserMessage = (text: string, index: number) => {
    if (!activeChat) return;
    setEditingMessage({ index, content: text });
    setInputText(text);
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setInputText('');
  };

  const handleSendMessage = async (userInputText: string, param2?: any[] | string, param3?: string) => {
    let customAttachments: any[] = [];
    let customChatId: string | undefined = undefined;

    if (Array.isArray(param2)) {
      customAttachments = param2;
      customChatId = param3;
    } else if (typeof param2 === 'string') {
      customChatId = param2;
    }

    let chatId = customChatId || activeChatId;
    if (!chatId) chatId = createNewChat();

    // If editing a message, update in place without erasing anything
    if (editingMessage !== null) {
      setChats((prev: any) => prev.map((c: any) => {
        if (c.id === chatId) {
          const updated = [...c.messages];
          if (updated[editingMessage.index]) {
            updated[editingMessage.index] = {
              ...updated[editingMessage.index],
              content: userInputText,
              editedAt: new Date().toISOString()
            };
          }
          return { ...c, messages: updated };
        }
        return c;
      }));
      setEditingMessage(null);
      setInputText('');
      return;
    }

    const finalContent = userInputText.trim() || (customAttachments.length > 0 ? `Analise ${customAttachments.length === 1 ? 'esta foto capturada' : 'estas fotos capturadas'}:` : '');

    const userMsg = {
      role: 'user',
      content: finalContent,
      attachments: customAttachments,
      timestamp: new Date().toISOString()
    };

    setChats((prev: any) => prev.map((c: any) => {
      if (c.id === chatId) {
        const titleText = finalContent || (customAttachments.length > 0 ? customAttachments[0].name : 'Nova Conversa');
        const title = c.messages.length === 0 ? (titleText.slice(0, 20) + '...') : c.title;
        return { ...c, title, messages: [...c.messages, userMsg] };
      }
      return c;
    }));

    setIsGenerating(true);

    const currentChat = chats.find((c: any) => c.id === chatId);
    const existingMsgs = currentChat ? currentChat.messages.filter((m: any) => (m.content && m.content.trim()) || (Array.isArray(m.attachments) && m.attachments.length > 0)) : [];
    const history = [...existingMsgs, userMsg];

    if (finalContent.startsWith('[IMAGE_GEN')) {
      const match = finalContent.match(/^\[IMAGE_GEN(?::([^\]]+))?\]\s*(.*)$/);
      const ratio = match?.[1] || '1:1';
      const prompt = match?.[2] || finalContent.replace('[IMAGE_GEN]', '').trim();
      setGenerationState('Gerando imagem...');
      try {
        const res = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, aspectRatio: ratio })
        });
        const data = await res.json();
        if (data.imageUrl) {
          const assistantMsg = {
            role: 'assistant',
            content: `Aqui está a sua imagem: **"${prompt}"** (Proporção: ${ratio})\n\n![Generated Image](${data.imageUrl})\n\n${data.text || ''}`,
            timestamp: new Date().toISOString()
          };
          setChats((prev: any) => prev.map((c: any) => {
            if (c.id === chatId) return { ...c, messages: [...c.messages, assistantMsg] };
            return c;
          }));
        } else {
          throw new Error(data.error || 'Falha ao gerar imagem');
        }
      } catch (err: any) {
        console.error('Image Gen Error:', err);
        const errMsg = {
          role: 'assistant',
          content: 'Não foi possível gerar a imagem no momento. Por favor, tente novamente.',
          timestamp: new Date().toISOString()
        };
        setChats((prev: any) => prev.map((c: any) => {
          if (c.id === chatId) return { ...c, messages: [...c.messages, errMsg] };
          return c;
        }));
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    let assistantContent = '';
    let hasCreatedAssistant = false;

    try {
      await aiProvider.streamResponse(
        history,
        (chunk) => {
          assistantContent += chunk;
          setChats((prev: any) => prev.map((c: any) => {
            if (c.id === chatId) {
              const updatedMsgs = [...c.messages];
              if (!hasCreatedAssistant) {
                hasCreatedAssistant = true;
                updatedMsgs.push({
                  role: 'assistant',
                  content: assistantContent,
                  timestamp: new Date().toISOString()
                });
              } else {
                updatedMsgs[updatedMsgs.length - 1] = {
                  ...updatedMsgs[updatedMsgs.length - 1],
                  content: assistantContent
                };
              }
              return { ...c, messages: updatedMsgs };
            }
            return c;
          }));
        },
        (stateText) => setGenerationState(stateText),
        settings.selectedModel,
        settings.personalityPrompt
      );
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
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

  const handleDownloadFullChat = (format: 'txt' | 'md' | 'html' | 'json' = 'txt') => {
    if (!activeChat || activeChat.messages.length === 0) return;
    
    let content = '';
    let mimeType = 'text/plain';
    
    if (format === 'json') {
      content = JSON.stringify(activeChat, null, 2);
      mimeType = 'application/json';
    } else if (format === 'html') {
      content = `
        <html>
          <head>
            <style>
              body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; background: #f4f4f9; }
              .msg { margin-bottom: 20px; padding: 15px; border-radius: 10px; background: white; border: 1px solid #ddd; }
              .user { border-left: 5px solid #7c3aed; }
              .assistant { border-left: 5px solid #10b981; }
              .role { font-weight: bold; text-transform: uppercase; font-size: 0.8em; margin-bottom: 5px; color: #666; }
            </style>
          </head>
          <body>
            <h1>Exportação de Chat - DEV AI</h1>
            ${activeChat.messages.map((m: any) => `
              <div class="msg ${m.role}">
                <div class="role">${m.role}</div>
                <div class="content">${m.content.replace(/\n/g, '<br>')}</div>
              </div>
            `).join('')}
          </body>
        </html>
      `;
      mimeType = 'text/html';
    } else {
      content = activeChat.messages.map((m: any) => `[${m.role.toUpperCase()}]\n${m.content}\n`).join('\n---\n\n');
      mimeType = 'text/markdown';
    }

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_export_${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Conversa baixada em .${format}`);
  };

  const canShare = activeChat?.myRole === 'admin' || !activeChat?.myRole || activeChat?.ownerId === myUserId;

  return (
    <div className="flex h-screen w-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans overflow-hidden antialiased">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 relative bg-white dark:bg-neutral-950">
        <header className="h-14 border-b border-neutral-200 dark:border-neutral-900 px-4 flex items-center justify-between bg-white dark:bg-neutral-950 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 rounded-lg"
            >
              <PanelLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-900 overflow-hidden border border-neutral-200 dark:border-neutral-800 flex items-center justify-center shadow-xs">
                <img src="/assets/aistudio/file_00000000c8f4820ea64dd2a2500a164b_98aeecae.png" alt="DEV AI" className="w-full h-full object-cover" />
              </div>
              <span className="font-bold text-sm text-neutral-900 dark:text-neutral-100 uppercase tracking-tighter">DEV AI</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setGeminiLiveOpen(true)}
              className="p-2 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg transition-colors"
              title="Iniciar Dev Live"
            >
              <PhoneCall className="w-5 h-5" />
            </button>

            {canShare && (
              <button
                onClick={() => setShareModalOpen(true)}
                className="p-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg transition-colors"
                title="Compartilhar Conversa"
              >
                <Share2 className="w-5 h-5" />
              </button>
            )}

            <div className="relative group/export">
              <button
                className="p-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg transition-colors"
                title="Download chat"
              >
                <Download className="w-5 h-5" />
              </button>
              <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl py-1 z-50 text-xs hidden group-hover/export:block">
                {[
                  { id: 'txt', label: 'Texto (.txt)' },
                  { id: 'md', label: 'Markdown (.md)' },
                  { id: 'html', label: 'Página Web (.html)' },
                  { id: 'json', label: 'Dados (.json)' }
                ].map(fmt => (
                  <button
                    key={fmt.id}
                    onClick={() => handleDownloadFullChat(fmt.id as any)}
                    className="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>
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
          editingMessage={editingMessage}
          onCancelEdit={handleCancelEdit}
          pendingAttachments={pendingAttachments}
          setPendingAttachments={setPendingAttachments}
        />
      </main>

      <ExpandedEditorModal text={inputText} setText={setInputText} onSend={() => handleSendMessage(inputText)} />
      <ModelSelectorModal />
      <ShareModal />
      <SettingsModal />
      <RenameModal />
      <DevLiveModal />
      <ImageGenModal onGenerate={(prompt, ratio) => handleSendMessage(`[IMAGE_GEN:${ratio}] ${prompt}`)} />
      <TextSelectionModal />
      <CameraModal onCapture={(photos) => {
        const newAtts = photos.map((url, idx) => ({
          id: 'cam_' + Date.now() + '_' + idx,
          name: `foto_camera_${idx + 1}.jpg`,
          size: 'Foto Câmera HD',
          type: 'image',
          url: url
        }));
        setPendingAttachments(prev => [...prev, ...newAtts]);
      }} />
      <HtmlPreviewModal
        isOpen={Boolean(previewHtmlCode)}
        onClose={() => setPreviewHtmlCode(null)}
        code={previewHtmlCode || ''}
        chatId={activeChat?.id}
        isGenerating={isGenerating}
      />
      <MediaPreviewModal />
      <ToastNotification message={toastMessage} />
    </div>
  );
}

// Media Preview Modal (opens when clicking attachments above input)
function MediaPreviewModal() {
  const { selectedMediaPreview, setSelectedMediaPreview } = useApp();
  if (!selectedMediaPreview) return null;

  return (
    <div className="fixed inset-0 z-[15000] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setSelectedMediaPreview(null)}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="max-w-4xl max-h-[85vh] flex flex-col items-center justify-center relative">
        {selectedMediaPreview.type === 'image' ? (
          <img src={selectedMediaPreview.url} alt="preview" className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl border border-white/10" />
        ) : selectedMediaPreview.type === 'video' ? (
          <video src={selectedMediaPreview.url} controls autoPlay className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl border border-white/10" />
        ) : (
          <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl text-center space-y-4 max-w-md w-full">
            <FileText className="w-16 h-16 text-emerald-400 mx-auto" />
            <h3 className="font-bold text-white text-base truncate">{selectedMediaPreview.name}</h3>
            <p className="text-xs text-neutral-400">Tamanho: {selectedMediaPreview.size}</p>
            <a
              href={selectedMediaPreview.url}
              download={selectedMediaPreview.name}
              className="inline-block px-6 py-2.5 bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg"
            >
              Baixar Arquivo
            </a>
          </div>
        )}
        <div className="mt-4 text-center">
          <p className="text-sm font-bold text-white">{selectedMediaPreview.name}</p>
          <p className="text-xs text-neutral-400 mt-1">{selectedMediaPreview.size}</p>
        </div>
      </div>
    </div>
  );
}

// Text Selection Modal for Mobile
function TextSelectionModal() {
  const { textSelectionData, setTextSelectionData, showToast } = useApp();
  if (!textSelectionData) return null;

  return (
    <div className="fixed inset-0 z-[10000] bg-white dark:bg-neutral-950 flex flex-col p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-between pb-4 border-b border-neutral-200 dark:border-neutral-900">
        <h3 className="font-black text-lg text-neutral-900 dark:text-white tracking-tighter">SELECIONAR TEXTO</h3>
        <button onClick={() => setTextSelectionData(null)} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-500">
          <X className="w-6 h-6" />
        </button>
      </div>
      
      <div className="flex-1 py-6 overflow-y-auto">
        <div className="bg-neutral-50 dark:bg-neutral-900 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100 text-sm leading-relaxed whitespace-pre-wrap select-text selection:bg-emerald-500/30 font-sans">
          {textSelectionData}
        </div>
      </div>

      <div className="pt-4 flex items-center justify-between border-t border-neutral-200 dark:border-neutral-900">
        <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Pressione e segure o texto para selecionar</p>
        <button 
          onClick={() => {
            navigator.clipboard.writeText(textSelectionData);
            showToast('Todo o texto copiado!');
          }}
          className="flex items-center gap-2 px-6 py-3 bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 rounded-2xl font-black text-xs shadow-xl active:scale-95 transition-all"
        >
          <Copy className="w-4 h-4" />
          <span>COPIAR TUDO</span>
        </button>
      </div>
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

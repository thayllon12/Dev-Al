import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

const aiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: aiKey });

const SUPPORTED_MODELS = [
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
];

app.get('/api/models', (req, res) => {
  res.json({ models: SUPPORTED_MODELS });
});

function getValidApiModel(modelName: string): string {
  const m = (modelName || '').toLowerCase();
  const found = SUPPORTED_MODELS.find((x: any) => x.name === m || x.displayName.toLowerCase() === m);
  if (found) return found.name;
  if (m.includes('pro') || m.includes('3.1-pro')) return 'gemini-3.1-pro-preview';
  return 'gemini-3.8-flash';
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model = 'gemini-3.8-flash' } = req.body;
    
    if (!aiKey) {
      return res.status(400).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const apiModel = getValidApiModel(model);

    const formattedContents = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const responseStream = await ai.models.generateContentStream({
      model: apiModel,
      contents: formattedContents,
      config: {
        systemInstruction: {
          parts: [{ text: 'Você é o DEV AI, um assistente de inteligência artificial avançado, técnico e direto ao ponto.' }]
        }
      }
    });

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    console.error('Gemini API Error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Erro ao processar com Gemini' })}\n\n`);
    res.end();
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), apiKeyConfigured: !!aiKey });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DEV AI V6 Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

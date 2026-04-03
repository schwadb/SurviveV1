import React, { useState, useRef, useEffect } from 'react';
import { Search, Loader2, Send, Trash2, AlertTriangle, ExternalLink, Sparkles, Key, Clock } from 'lucide-react';
import { perplexitySearch } from '../../services/api';
import { useSettings } from '../../hooks/useLocalStorage';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import SearchHistory from '../common/SearchHistory';
import toast from 'react-hot-toast';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  timestamp: string;
  isError?: boolean;
}

const SUGGESTED_QUERIES = [
  'Find recent OSINT techniques for tracking maritime vessels',
  'What are the best free satellite tracking APIs available in 2025?',
  'How does ADS-B aircraft tracking work technically?',
  'Explain license plate reader (LPR) surveillance networks',
  'Latest tools for social media OSINT investigations',
  'How to use Shodan for finding exposed devices',
  'Google dorking advanced techniques for OSINT',
  'How do ship AIS transponders work and can they be spoofed?',
  'Best practices for OSINT phone number investigation',
  'How to identify and track drone flights in restricted airspace',
];

const PerplexitySearch: React.FC = () => {
  const [settings, setSettings] = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(!settings.perplexityApiKey);
  const [tempKey, setTempKey] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { addEntry } = useSearchHistory();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveApiKey = () => {
    if (!tempKey.trim()) return;
    setSettings(s => ({ ...s, perplexityApiKey: tempKey }));
    setShowKeyInput(false);
    setTempKey('');
    toast.success('Perplexity API key saved');
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    if (!settings.perplexityApiKey) { setShowKeyInput(true); return; }

    const query = input.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    addEntry({ query, type: 'ai' });

    try {
      const { content, citations } = await perplexitySearch(query, settings.perplexityApiKey);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content,
        citations,
        timestamp: new Date().toISOString(),
      }]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Request failed';
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: msg,
        timestamp: new Date().toISOString(),
        isError: true,
      }]);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      if (line.startsWith('# ')) return <h3 key={i} className="text-lg font-bold text-gray-100 mt-4 mb-2">{line.slice(2)}</h3>;
      if (line.startsWith('## ')) return <h4 key={i} className="text-base font-semibold text-gray-200 mt-3 mb-1">{line.slice(3)}</h4>;
      if (line.startsWith('### ')) return <h5 key={i} className="text-sm font-semibold text-gray-300 mt-2 mb-1">{line.slice(4)}</h5>;
      if (line.startsWith('- ') || line.startsWith('* ')) return (
        <li key={i} className="ml-4 text-sm text-gray-300 list-disc my-0.5">{line.slice(2)}</li>
      );
      if (line.match(/^\d+\. /)) return (
        <li key={i} className="ml-4 text-sm text-gray-300 list-decimal my-0.5">{line.replace(/^\d+\. /, '')}</li>
      );
      if (line === '') return <div key={i} className="h-2" />;
      // Inline bold
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={i} className="text-sm text-gray-300 leading-relaxed">
          {parts.map((p, j) =>
            p.startsWith('**') && p.endsWith('**')
              ? <strong key={j} className="text-gray-100 font-semibold">{p.slice(2, -2)}</strong>
              : p
          )}
        </p>
      );
    });
  };

  return (
    <div className="space-y-4">
      {/* API key setup */}
      {showKeyInput && (
        <div className="card glow-border">
          <div className="flex items-center gap-2 mb-3">
            <Key size={18} className="text-violet-400" />
            <h3 className="section-title">Perplexity AI API Key</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Enter your API key to enable AI-powered OSINT research. Get a key at{' '}
            <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noopener noreferrer"
              className="text-violet-400 hover:underline inline-flex items-center gap-1">
              perplexity.ai <ExternalLink size={12} />
            </a>
          </p>
          <div className="flex gap-3">
            <input type="password" className="input-field flex-1" placeholder="pplx-xxxxxxxxxxxxxxxxxxxx"
              value={tempKey} onChange={e => setTempKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey()} />
            <button onClick={saveApiKey} disabled={!tempKey.trim()} className="btn-primary">
              <Key size={15} />Save
            </button>
            {settings.perplexityApiKey && (
              <button onClick={() => setShowKeyInput(false)} className="btn-secondary">Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* Chat Interface */}
      <div className="card flex flex-col">
        <div className="card-header">
          <Sparkles size={18} className="text-violet-400" />
          <h3 className="section-title">Perplexity AI OSINT Research</h3>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
              <Clock size={12} />History
            </button>
            <button onClick={() => setShowKeyInput(!showKeyInput)}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
              <Key size={12} />{settings.perplexityApiKey ? 'Key ✓' : 'Add Key'}
            </button>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
                <Trash2 size={12} />Clear
              </button>
            )}
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <SearchHistory typeFilter="ai" onSelect={(q) => { setInput(q); setShowHistory(false); }} />
          </div>
        )}

        {/* Messages */}
        <div className="space-y-4 mb-4 overflow-y-auto" style={{ maxHeight: '420px', minHeight: '200px' }}>
          {messages.length === 0 ? (
            <div className="py-8 text-center">
              <Sparkles size={40} className="mx-auto text-violet-400/30 mb-3" />
              <p className="text-gray-500 text-sm mb-1">Ask anything about OSINT, tracking, or intelligence gathering</p>
              <p className="text-gray-600 text-xs">Powered by Perplexity AI with real-time web search & citations</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-xl px-4 py-3 ${
                  msg.role === 'user' ? 'bg-indigo-600 text-white'
                    : msg.isError ? 'bg-red-900/30 border border-red-800'
                    : 'bg-gray-800 border border-gray-700'
                }`}>
                  {msg.role === 'user'
                    ? <p className="text-sm">{msg.content}</p>
                    : <div className="space-y-1">{formatContent(msg.content)}</div>
                  }
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-gray-700">
                      <p className="text-xs text-gray-500 mb-1">Sources:</p>
                      <div className="space-y-1">
                        {msg.citations.slice(0, 5).map((cite, i) => (
                          <a key={i} href={cite} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 truncate">
                            <ExternalLink size={10} className="flex-shrink-0" />
                            {cite.replace(/^https?:\/\//, '').slice(0, 60)}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs opacity-40 mt-2">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-violet-400" />
                <span className="text-sm text-gray-400">Searching the web...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-800 pt-4">
          <div className="flex gap-2">
            <textarea ref={textareaRef} className="input-field flex-1 resize-none" rows={2}
              placeholder={settings.perplexityApiKey ? 'Ask an OSINT question... (Enter to send, Shift+Enter for new line)' : 'Add Perplexity API key to start searching...'}
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              disabled={!settings.perplexityApiKey} />
            <button onClick={handleSend} disabled={!input.trim() || isLoading || !settings.perplexityApiKey}
              className="btn-primary self-end">
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Suggestions */}
      <div className="card">
        <div className="card-header">
          <Search size={16} className="text-gray-400" />
          <h3 className="section-title">Suggested OSINT Queries</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SUGGESTED_QUERIES.map(query => (
            <button key={query} onClick={() => { setInput(query); textareaRef.current?.focus(); }}
              className="text-left p-3 bg-gray-900 hover:bg-gray-800 rounded-lg border border-gray-800 hover:border-violet-700/50 transition-all group">
              <p className="text-xs text-gray-400 group-hover:text-violet-300 flex items-start gap-2">
                <Sparkles size={11} className="text-violet-500 flex-shrink-0 mt-0.5" />
                {query}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Warning */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-3 flex gap-3">
        <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-400/80">
          AI-generated content may contain errors. Always verify OSINT findings through multiple authoritative sources.
          Your API key is stored locally in your browser only.
        </p>
      </div>
    </div>
  );
};

export default PerplexitySearch;

import React, { useState, useRef, useEffect } from 'react';
import { Search, Loader2, Send, Trash2, AlertTriangle, ExternalLink, Sparkles, Key } from 'lucide-react';
import { perplexitySearch } from '../../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isError?: boolean;
}

const SUGGESTED_QUERIES = [
  'Find recent OSINT techniques for tracking maritime vessels',
  'What are the best free satellite tracking APIs?',
  'How to use ADS-B data for aircraft surveillance',
  'Explain SIGINT vs OSINT differences',
  'Latest tools for social media OSINT investigations',
  'Public records search techniques for address verification',
  'How do police license plate readers work?',
  'Best practices for phone number OSINT research',
  'How to track ships using free AIS data',
  'Google dorking techniques for OSINT investigations',
];

const PerplexitySearch: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('watcher-perplexity-key') || '');
  const [showKeyInput, setShowKeyInput] = useState(!localStorage.getItem('watcher-perplexity-key'));
  const [tempKey, setTempKey] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveApiKey = () => {
    if (!tempKey.trim()) return;
    localStorage.setItem('watcher-perplexity-key', tempKey);
    setApiKey(tempKey);
    setShowKeyInput(false);
    setTempKey('');
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await perplexitySearch(input.trim(), apiKey);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: unknown) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'An error occurred. Please check your API key.',
        timestamp: new Date().toISOString(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (query: string) => {
    setInput(query);
    textareaRef.current?.focus();
  };

  const clearMessages = () => setMessages([]);

  const formatContent = (content: string) => {
    // Basic markdown-like formatting
    return content
      .split('\n')
      .map((line, i) => {
        if (line.startsWith('# ')) return <h3 key={i} className="text-lg font-bold text-gray-100 mt-3 mb-1">{line.slice(2)}</h3>;
        if (line.startsWith('## ')) return <h4 key={i} className="text-base font-semibold text-gray-200 mt-2 mb-1">{line.slice(3)}</h4>;
        if (line.startsWith('- ') || line.startsWith('* ')) return (
          <li key={i} className="ml-4 text-gray-300 text-sm list-disc">{line.slice(2)}</li>
        );
        if (line.startsWith('**') && line.endsWith('**')) return (
          <strong key={i} className="text-gray-100 block">{line.slice(2, -2)}</strong>
        );
        if (line === '') return <br key={i} />;
        return <p key={i} className="text-sm text-gray-300 leading-relaxed">{line}</p>;
      });
  };

  return (
    <div className="space-y-4">
      {/* API Key Setup */}
      {showKeyInput && (
        <div className="card glow-border">
          <div className="flex items-center gap-2 mb-3">
            <Key size={18} className="text-violet-400" />
            <h3 className="section-title">Perplexity AI API Key</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Enter your Perplexity AI API key to enable AI-powered OSINT searches. Get a key at{' '}
            <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
              perplexity.ai/settings/api
            </a>
          </p>
          <div className="flex gap-3">
            <input
              type="password"
              className="input-field flex-1"
              placeholder="pplx-xxxxxxxxxxxxxxxxxxxx"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
            />
            <button onClick={saveApiKey} disabled={!tempKey.trim()} className="btn-primary">
              <Key size={15} />
              Save Key
            </button>
            {apiKey && (
              <button onClick={() => setShowKeyInput(false)} className="btn-secondary">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chat Interface */}
      <div className="card flex flex-col" style={{ minHeight: '500px' }}>
        <div className="card-header">
          <Sparkles size={18} className="text-violet-400" />
          <h3 className="section-title">Perplexity AI OSINT Assistant</h3>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
            >
              <Key size={12} />
              {apiKey ? 'Change Key' : 'Add Key'}
            </button>
            {messages.length > 0 && (
              <button onClick={clearMessages} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
                <Trash2 size={12} />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4" style={{ maxHeight: '400px' }}>
          {messages.length === 0 ? (
            <div className="py-8 text-center">
              <Sparkles size={40} className="mx-auto text-violet-400/30 mb-3" />
              <p className="text-gray-500 text-sm mb-2">Ask anything about OSINT, tracking, or intelligence gathering</p>
              <p className="text-gray-600 text-xs">Powered by Perplexity AI with real-time web search</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : msg.isError
                      ? 'bg-red-900/30 border border-red-800 text-red-300'
                      : 'bg-gray-800 border border-gray-700'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <div className="space-y-1">{formatContent(msg.content)}</div>
                  )}
                  <p className="text-xs opacity-50 mt-2">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </p>
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
            <textarea
              ref={textareaRef}
              className="input-field flex-1 resize-none"
              placeholder={apiKey ? 'Ask an OSINT question... (Shift+Enter for new line)' : 'Add API key to start searching...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={!apiKey}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading || !apiKey}
              className="btn-primary self-end"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Suggested queries */}
      <div className="card">
        <div className="card-header">
          <Search size={16} className="text-gray-400" />
          <h3 className="section-title">Suggested OSINT Queries</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SUGGESTED_QUERIES.map((query) => (
            <button
              key={query}
              onClick={() => handleSuggestion(query)}
              className="text-left p-3 bg-gray-900 hover:bg-gray-800 rounded-lg border border-gray-800 hover:border-violet-700/50 transition-all group"
            >
              <p className="text-xs text-gray-400 group-hover:text-violet-300 transition-colors flex items-start gap-2">
                <Sparkles size={12} className="text-violet-500 flex-shrink-0 mt-0.5" />
                {query}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* API Info */}
      <div className="card">
        <div className="card-header">
          <AlertTriangle size={16} className="text-yellow-400" />
          <h3 className="section-title">API Information</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-gray-900 rounded-lg p-3">
            <p className="text-gray-400 font-medium mb-1">Model</p>
            <p className="text-xs text-gray-500">llama-3.1-sonar-large-128k-online</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-3">
            <p className="text-gray-400 font-medium mb-1">Features</p>
            <p className="text-xs text-gray-500">Real-time web search + citations</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-3">
            <p className="text-gray-400 font-medium mb-1">Get API Key</p>
            <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noopener noreferrer"
              className="text-xs text-violet-400 hover:underline flex items-center gap-1">
              <ExternalLink size={11} />
              perplexity.ai
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerplexitySearch;

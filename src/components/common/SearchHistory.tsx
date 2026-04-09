import React from 'react';
import { Clock, Trash2, X, Search } from 'lucide-react';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import { format } from 'date-fns';

interface SearchHistoryProps {
  typeFilter?: string;
  onSelect?: (query: string) => void;
  compact?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  person: '👤 Person',
  phone: '📞 Phone',
  address: '📍 Address',
  email: '✉️ Email',
  domain: '🌐 Domain',
  ai: '🤖 AI',
  username: '🔍 Username',
  dork: '🎯 Dork',
};

const SearchHistory: React.FC<SearchHistoryProps> = ({ typeFilter, onSelect, compact = false }) => {
  const { history, clearHistory, removeEntry } = useSearchHistory();

  const filtered = typeFilter
    ? history.filter((e) => e.type === typeFilter)
    : history;

  if (filtered.length === 0) return null;

  return (
    <div className={compact ? '' : 'card'}>
      {!compact && (
        <div className="card-header">
          <Clock size={16} className="text-gray-400" />
          <h3 className="section-title">Search History</h3>
          <button onClick={clearHistory}
            className="ml-auto text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
            <Trash2 size={12} />Clear all
          </button>
        </div>
      )}

      <div className="space-y-1 max-h-60 overflow-y-auto">
        {filtered.slice(0, 20).map((entry) => (
          <div key={entry.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800 group cursor-pointer"
            onClick={() => onSelect?.(entry.query)}>
            <Search size={12} className="text-gray-600 flex-shrink-0" />
            <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">
              {TYPE_LABELS[entry.type] ?? entry.type}
            </span>
            <span className="text-sm text-gray-300 flex-1 truncate">{entry.query}</span>
            <span className="text-xs text-gray-600 flex-shrink-0 hidden group-hover:hidden">
              {format(new Date(entry.timestamp), 'MM/dd HH:mm')}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); removeEntry(entry.id); }}
              className="p-0.5 text-gray-700 hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SearchHistory;

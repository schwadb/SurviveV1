import React from 'react';
import { X, AlertTriangle, Info, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import type { Alert } from '../../types';

interface AlertsPanelProps {
  alerts: Alert[];
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onClearAll: () => void;
}

const alertIcons = {
  info: <Info size={16} className="text-blue-400" />,
  warning: <AlertTriangle size={16} className="text-yellow-400" />,
  danger: <XCircle size={16} className="text-red-400" />,
  success: <CheckCircle size={16} className="text-green-400" />,
};

const alertBg = {
  info: 'border-l-blue-500 bg-blue-900/10',
  warning: 'border-l-yellow-500 bg-yellow-900/10',
  danger: 'border-l-red-500 bg-red-900/10',
  success: 'border-l-green-500 bg-green-900/10',
};

const AlertsPanel: React.FC<AlertsPanelProps> = ({ alerts, onClose, onMarkRead, onClearAll }) => {
  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-[#111827] border-l border-gray-800 z-50 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-yellow-400" />
          <h3 className="text-white font-semibold">Alerts</h3>
          {alerts.filter((a) => !a.read).length > 0 && (
            <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full">
              {alerts.filter((a) => !a.read).length} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClearAll}
            className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 px-2 py-1 hover:bg-gray-800 rounded"
          >
            <Trash2 size={12} />
            Clear
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <CheckCircle size={32} className="mb-2" />
            <p className="text-sm">No alerts</p>
          </div>
        ) : (
          alerts.map((alert) => (
            <button
              key={alert.id}
              onClick={() => onMarkRead(alert.id)}
              className={`w-full text-left p-3 rounded-lg border-l-2 ${alertBg[alert.type]} ${
                alert.read ? 'opacity-50' : ''
              } transition-opacity hover:opacity-80`}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5">{alertIcons[alert.type]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-200 truncate">{alert.title}</p>
                    {!alert.read && (
                      <span className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full" />
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{alert.message}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {new Date(alert.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default AlertsPanel;

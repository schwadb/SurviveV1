import React from 'react';
import { Bell, RefreshCw, Wifi, Globe, Clock } from 'lucide-react';
import type { Alert } from '../../types';

interface HeaderProps {
  title: string;
  subtitle?: string;
  alerts: Alert[];
  onAlertsClick: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  alerts,
  onAlertsClick,
  onRefresh,
  isRefreshing = false,
}) => {
  const unreadCount = alerts.filter((a) => !a.read).length;
  const [time, setTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="bg-[#111827] border-b border-gray-800 px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Title area - left padded on mobile for hamburger */}
        <div className="pl-10 lg:pl-0">
          <h2 className="text-white font-semibold text-lg leading-none">{title}</h2>
          {subtitle && <p className="text-gray-500 text-xs mt-1">{subtitle}</p>}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Status indicators - hidden on small mobile */}
          <div className="hidden sm:flex items-center gap-3 mr-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Wifi size={13} className="text-green-500" />
              <span className="hidden md:inline">Connected</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Globe size={13} className="text-blue-400" />
              <span className="hidden md:inline">UTC</span>
              <span className="font-mono text-gray-400">
                {time.toUTCString().slice(17, 25)}
              </span>
            </div>
          </div>

          {/* UTC Clock - always visible */}
          <div className="flex items-center gap-1 text-xs text-gray-500 sm:hidden">
            <Clock size={12} />
            <span className="font-mono">{time.toUTCString().slice(17, 22)}</span>
          </div>

          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          )}

          {/* Alerts */}
          <button
            onClick={onAlertsClick}
            className="relative p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
            title="Alerts"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-medium">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;

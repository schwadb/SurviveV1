import React, { useState } from 'react';
import { Radar, Plus, Trash2, Play, Bell, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMonitors } from '../hooks/useMonitors';
import { useNotifications } from '../hooks/useNotifications';
import { detectSelectorType } from '../services/osint';
import {
  CHECK_LABELS, checksForTarget, runMonitorNow,
  type Monitor, type MonitorCheck,
} from '../services/monitor';

const INTERVALS = [5, 15, 30, 60, 240];

const SEV_DOT: Record<string, string> = {
  info: 'bg-blue-500', warning: 'bg-yellow-500', danger: 'bg-red-500',
};

function targetTypeFor(value: string): Monitor['targetType'] {
  const t = detectSelectorType(value);
  if (t === 'ip') return 'ip';
  if (t === 'username') return 'username';
  if (t === 'domain') return 'domain';
  if (value.startsWith('http')) return 'url';
  return 'domain';
}

const Monitors: React.FC = () => {
  const { monitors, events, addMonitor, removeMonitor, toggleMonitor, saveMonitor, clearEvents } = useMonitors();
  const { notify } = useNotifications();
  const [target, setTarget] = useState('');
  const [interval, setIntervalMin] = useState(15);
  const [running, setRunning] = useState<string | null>(null);

  const detectedType = target.trim() ? targetTypeFor(target.trim()) : 'domain';
  const available = checksForTarget(detectedType);
  const [check, setCheck] = useState<MonitorCheck>('dns');
  // Keep the selected check valid for the detected target type.
  const effectiveCheck = available.includes(check) ? check : available[0];

  const handleAdd = () => {
    const v = target.trim();
    if (!v) return;
    addMonitor({
      name: `${CHECK_LABELS[effectiveCheck]} · ${v}`,
      targetType: detectedType,
      target: v,
      check: effectiveCheck,
      intervalMinutes: Math.max(5, interval),
    });
    toast.success('Monitor added — baseline will be captured on the next run');
    setTarget('');
  };

  const handleRunNow = async (m: Monitor) => {
    setRunning(m.id);
    try {
      await runMonitorNow(m, {
        saveMonitor,
        onEvent: () => {},
        notify: (t, b, o) => notify(t, b, o),
      });
      toast.success('Ran monitor');
    } catch {
      toast.error('Run failed');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="card">
        <div className="card-header">
          <Radar size={18} className="text-emerald-400" />
          <h3 className="section-title">Add Monitor</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <input
              className="input-field w-full"
              placeholder="Target — domain, IP, username, or URL"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="sm:w-52">
            <select value={effectiveCheck} onChange={(e) => setCheck(e.target.value as MonitorCheck)} className="input-field w-full">
              {available.map((c) => <option key={c} value={c}>{CHECK_LABELS[c]}</option>)}
            </select>
          </div>
          <div className="sm:w-36">
            <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))} className="input-field w-full">
              {INTERVALS.map((m) => <option key={m} value={m}>every {m}m</option>)}
            </select>
          </div>
          <button onClick={handleAdd} disabled={!target.trim()} className="btn-primary"><Plus size={15} /> Add</button>
        </div>
        {target.trim() && (
          <p className="text-xs text-gray-500 mt-2">Detected target type: <span className="text-gray-300">{detectedType}</span></p>
        )}
      </div>

      {/* Monitor list */}
      <div className="card">
        <div className="card-header">
          <Radar size={16} className="text-emerald-400" />
          <h3 className="section-title">Active Monitors</h3>
          <span className="badge badge-blue ml-auto">{monitors.length}</span>
        </div>
        {monitors.length === 0 ? (
          <p className="text-sm text-gray-500">No monitors yet. Add one above to watch a target for changes.</p>
        ) : (
          <div className="space-y-2">
            {monitors.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                <div className={`w-2 h-2 rounded-full ${m.enabled ? 'bg-emerald-500 live-indicator' : 'bg-gray-600'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{m.target}</p>
                  <p className="text-xs text-gray-500">
                    {CHECK_LABELS[m.check]} · every {m.intervalMinutes}m
                    {m.lastRunAt ? ` · last run ${new Date(m.lastRunAt).toLocaleTimeString()}` : ' · not run yet'}
                  </p>
                </div>
                <button onClick={() => handleRunNow(m)} disabled={running === m.id} title="Run now" className="text-gray-400 hover:text-emerald-400">
                  {running === m.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                </button>
                <button onClick={() => toggleMonitor(m.id)} className={`text-xs px-2 py-1 rounded ${m.enabled ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                  {m.enabled ? 'On' : 'Off'}
                </button>
                <button onClick={() => removeMonitor(m.id)} title="Delete" className="text-gray-500 hover:text-red-400"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Event feed */}
      <div className="card">
        <div className="card-header">
          <Bell size={16} className="text-yellow-400" />
          <h3 className="section-title">Change Events</h3>
          <span className="badge badge-yellow ml-auto">{events.length}</span>
          {events.length > 0 && (
            <button onClick={clearEvents} className="text-xs text-gray-500 hover:text-gray-300 ml-2">Clear</button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No changes detected yet. Monitors alert here (and via notification) when a target changes.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {events.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 text-sm border-b border-gray-800 pb-2">
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[ev.severity]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200">{ev.monitorName}</p>
                  <p className="text-xs text-gray-400">{ev.summary}</p>
                </div>
                <span className="text-xs text-gray-600 flex-shrink-0">{new Date(ev.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Monitors;

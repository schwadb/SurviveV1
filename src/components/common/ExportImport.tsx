import React from 'react';
import { Download, Upload, FileJson, FileText } from 'lucide-react';
import { toCSV, toJSON, importJSON } from '../../services/api';
import toast from 'react-hot-toast';

interface ExportImportProps<T> {
  data: T[];
  filename: string;
  onImport?: (data: T[]) => void;
  label?: string;
}

function ExportImport<T extends Record<string, unknown>>({
  data,
  filename,
  onImport,
  label = 'Data',
}: ExportImportProps<T>) {
  const handleCSV = () => {
    if (data.length === 0) { toast.error('No data to export'); return; }
    toCSV(data, `${filename}.csv`);
    toast.success(`Exported ${data.length} ${label} records as CSV`);
  };

  const handleJSON = () => {
    if (data.length === 0) { toast.error('No data to export'); return; }
    toJSON(data, `${filename}.json`);
    toast.success(`Exported ${data.length} ${label} records as JSON`);
  };

  const handleImport = async () => {
    try {
      const imported = await importJSON();
      if (!Array.isArray(imported)) throw new Error('File must contain a JSON array');
      onImport?.(imported as T[]);
      toast.success(`Imported ${(imported as T[]).length} ${label} records`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={handleCSV} className="btn-secondary text-xs">
        <FileText size={13} />
        Export CSV
      </button>
      <button onClick={handleJSON} className="btn-secondary text-xs">
        <FileJson size={13} />
        Export JSON
      </button>
      {onImport && (
        <button onClick={handleImport} className="btn-secondary text-xs">
          <Upload size={13} />
          Import JSON
        </button>
      )}
      <span className="text-xs text-gray-600">{data.length} records</span>
    </div>
  );
}

export default ExportImport;

// Standalone export bar for sections
export const ExportBar: React.FC<{
  data: Record<string, unknown>[];
  filename: string;
  label?: string;
  onImport?: (data: Record<string, unknown>[]) => void;
}> = ({ data, filename, label, onImport }) => (
  <div className="flex items-center gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
    <Download size={14} className="text-gray-500" />
    <span className="text-xs text-gray-500 flex-1">Export / Import {label}</span>
    <ExportImport data={data} filename={filename} label={label} onImport={onImport} />
  </div>
);

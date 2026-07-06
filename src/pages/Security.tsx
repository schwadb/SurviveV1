import React, { useState } from 'react';
import {
  ShieldCheck, KeyRound, Lock, Unlock, AlertTriangle, Trash2, Eye, EyeOff,
  Loader2, Copy, Radio, HardDrive,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { pwnedPassword } from '../services/osint';
import { encryptText, decryptText, passphraseStrength, panicWipe } from '../services/vault';

// Where each feature sends data. Drives the egress-transparency ledger so the
// analyst can reason about their own footprint (mirrors Hunchly-style OPSEC).
const EGRESS: { feature: string; host: string; sends: string; note?: string }[] = [
  { feature: 'Dashboard / Dork Builder / Watchlist / Graph layout', host: '— local only —', sends: 'Nothing leaves your browser' },
  { feature: 'Aircraft tracker', host: 'opensky-network.org', sends: 'Map bounding box' },
  { feature: 'Satellite tracker', host: 'celestrak.org', sends: 'Group name only' },
  { feature: 'Ship tracker', host: 'stream.aisstream.io', sends: 'API key + bounding box' },
  { feature: 'Address lookup', host: 'nominatim.openstreetmap.org', sends: 'The address you type' },
  { feature: 'Phone lookup', host: 'apilayer.net', sends: 'Phone number + API key', note: 'key in URL' },
  { feature: 'AI research', host: 'api.perplexity.ai', sends: 'Your query + any tactical context' },
  { feature: 'Graph pivots · Live Recon', host: 'dns.google · internetdb.shodan.io · ipwho.is · archive.org · api.github.com', sends: 'The selector you pivot on' },
  { feature: 'Pwned-password check', host: 'api.pwnedpasswords.com', sends: 'First 5 chars of SHA-1 only (k-anonymity)' },
  { feature: 'Map tiles', host: 'basemaps.cartocdn.com', sends: 'Tile coordinates (your view area)' },
];

const Security: React.FC = () => {
  // Pwned password checker
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwResult, setPwResult] = useState<{ count: number; error?: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // Vault
  const [vaultText, setVaultText] = useState('');
  const [vaultPass, setVaultPass] = useState('');
  const [vaultOut, setVaultOut] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);

  // Panic wipe
  const [confirmWipe, setConfirmWipe] = useState(false);

  const checkPassword = async () => {
    if (!pw) return;
    setPwLoading(true);
    setPwResult(null);
    const r = await pwnedPassword(pw);
    setPwResult(r);
    setPwLoading(false);
  };

  const strength = passphraseStrength(vaultPass);

  const doEncrypt = async () => {
    if (!vaultText || !vaultPass) { toast.error('Enter text and a passphrase'); return; }
    setVaultBusy(true);
    try {
      setVaultOut(await encryptText(vaultText, vaultPass));
      toast.success('Encrypted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Encryption failed');
    } finally { setVaultBusy(false); }
  };

  const doDecrypt = async () => {
    if (!vaultText || !vaultPass) { toast.error('Paste a blob and its passphrase'); return; }
    setVaultBusy(true);
    try {
      setVaultOut(await decryptText(vaultText.trim(), vaultPass));
      toast.success('Decrypted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Decryption failed');
    } finally { setVaultBusy(false); }
  };

  const doWipe = async () => {
    await panicWipe();
    toast.success('All local data wiped. Reloading…');
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Intro */}
      <div className="card glow-border">
        <div className="flex items-center gap-3">
          <ShieldCheck size={28} className="text-green-400 flex-shrink-0" />
          <div>
            <h2 className="text-lg font-bold text-white">Security &amp; OPSEC Center</h2>
            <p className="text-sm text-gray-400">
              This app is client-side only — there is no server collecting your data, and no telemetry.
              Use these tools to check exposure, encrypt sensitive material locally, and control your footprint.
            </p>
          </div>
        </div>
      </div>

      {/* Pwned password */}
      <div className="card">
        <div className="card-header">
          <KeyRound size={18} className="text-yellow-400" />
          <h3 className="section-title">Password Exposure Check</h3>
          <span className="badge badge-green ml-auto">k-anonymity · no key</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Checks Have I Been Pwned's breach corpus. Only the first 5 characters of your password's
          SHA-1 hash are ever sent — the password itself never leaves this browser.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showPw ? 'text' : 'password'} className="input-field pr-9"
              placeholder="Enter a password to test" value={pw}
              onChange={(e) => { setPw(e.target.value); setPwResult(null); }}
              onKeyDown={(e) => e.key === 'Enter' && checkPassword()}
            />
            <button onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button onClick={checkPassword} disabled={pwLoading || !pw} className="btn-primary">
            {pwLoading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Check
          </button>
        </div>
        {pwResult && !pwResult.error && (
          pwResult.count > 0 ? (
            <div className="mt-3 p-3 rounded-lg bg-red-900/20 border border-red-700/50 flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">
                Found in <strong>{pwResult.count.toLocaleString()}</strong> breaches. This password is compromised — never use it.
              </p>
            </div>
          ) : (
            <div className="mt-3 p-3 rounded-lg bg-green-900/20 border border-green-700/50 flex items-start gap-2">
              <ShieldCheck size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-300">Not found in any known breach. (This does not guarantee it's strong.)</p>
            </div>
          )
        )}
        {pwResult?.error && <p className="mt-2 text-xs text-amber-400">Lookup error: {pwResult.error}</p>}
      </div>

      {/* Encrypted vault */}
      <div className="card">
        <div className="card-header">
          <Lock size={18} className="text-indigo-400" />
          <h3 className="section-title">Local Encryption Vault</h3>
          <span className="badge badge-blue ml-auto">AES-256-GCM</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Encrypt notes, API keys, or an exported case with a passphrase (PBKDF2, 250k iterations).
          Everything runs in-browser. Store the encrypted blob anywhere; decrypt it here later.
        </p>
        <textarea
          className="input-field text-xs font-mono" rows={4}
          placeholder="Plaintext to encrypt, or paste a WV1… blob to decrypt"
          value={vaultText} onChange={(e) => setVaultText(e.target.value)}
        />
        <div className="mt-2">
          <input
            type="password" className="input-field" placeholder="Passphrase"
            value={vaultPass} onChange={(e) => setVaultPass(e.target.value)}
          />
          {vaultPass && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden">
                <div className="h-full transition-all" style={{
                  width: `${(strength.score / 4) * 100}%`,
                  background: strength.score >= 3 ? '#22c55e' : strength.score >= 2 ? '#eab308' : '#ef4444',
                }} />
              </div>
              <span className="text-xs text-gray-500">{strength.label}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={doEncrypt} disabled={vaultBusy} className="btn-primary text-sm">
            {vaultBusy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Encrypt
          </button>
          <button onClick={doDecrypt} disabled={vaultBusy} className="btn-secondary text-sm">
            <Unlock size={14} /> Decrypt
          </button>
        </div>
        {vaultOut && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-500">Output</span>
              <button
                onClick={() => { navigator.clipboard.writeText(vaultOut); toast.success('Copied'); }}
                className="text-gray-500 hover:text-gray-300"
              ><Copy size={12} /></button>
            </div>
            <pre className="text-xs text-green-400 bg-gray-900 border border-gray-800 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">{vaultOut}</pre>
          </div>
        )}
      </div>

      {/* Egress ledger */}
      <div className="card">
        <div className="card-header">
          <Radio size={18} className="text-cyan-400" />
          <h3 className="section-title">Network Egress Ledger</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Exactly which external hosts each feature contacts, and what it sends. Anything marked
          <span className="text-green-400"> local only</span> never touches the network.
        </p>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Feature</th><th>Destination host</th><th>What is sent</th></tr></thead>
            <tbody>
              {EGRESS.map((row) => (
                <tr key={row.feature}>
                  <td className="text-gray-300">{row.feature}</td>
                  <td className={row.host.includes('local') ? 'text-green-400' : 'text-gray-400 font-mono text-xs'}>{row.host}</td>
                  <td className="text-gray-500">
                    {row.sends}
                    {row.note && <span className="badge badge-yellow ml-2">{row.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panic wipe */}
      <div className="card border-red-900/40">
        <div className="card-header">
          <HardDrive size={18} className="text-red-400" />
          <h3 className="section-title text-red-300">Panic Wipe</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Immediately erase <strong>all</strong> WatcherV1 data from this browser — settings, API keys,
          search history, watchlist, saved dorks, investigations, and recorded sessions (localStorage + IndexedDB).
          This cannot be undone.
        </p>
        {!confirmWipe ? (
          <button onClick={() => setConfirmWipe(true)} className="btn-secondary text-sm border-red-800 text-red-300 hover:bg-red-900/30">
            <Trash2 size={14} /> Wipe all local data
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-300">Are you sure?</span>
            <button onClick={doWipe} className="btn-primary text-sm" style={{ background: '#dc2626' }}>
              <AlertTriangle size={14} /> Yes, wipe everything
            </button>
            <button onClick={() => setConfirmWipe(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Security;

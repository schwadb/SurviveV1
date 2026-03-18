import React, { useState } from 'react';
import { Phone, Search, ExternalLink, AlertTriangle, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface PhoneResult {
  number: string;
  isValid: boolean;
  country?: string;
  carrier?: string;
  lineType?: string;
  location?: string;
  spamLikelihood?: string;
}

const PHONE_RESOURCES = [
  { name: 'TrueCaller', url: 'https://www.truecaller.com/search/', description: 'Spam identification & reverse lookup' },
  { name: 'WhitePages', url: 'https://www.whitepages.com/phone/', description: 'Carrier & owner info' },
  { name: 'Spokeo', url: 'https://www.spokeo.com/phone-search/', description: 'Full background' },
  { name: 'NumLookup', url: 'https://www.numlookup.com/?number=', description: 'Free reverse phone lookup' },
  { name: 'RevealName', url: 'https://www.revealname.com/', description: 'Free caller ID lookup' },
  { name: 'Free Carrier Lookup', url: 'https://freecarrierlookup.com/', description: 'Carrier & line type' },
  { name: 'PhoneInfoga', url: 'https://github.com/sundowndev/phoneinfoga', description: 'CLI OSINT tool' },
  { name: 'CNAM Lookup', url: 'https://opencnam.com/', description: 'Caller name lookup' },
];

const PhoneLookup: React.FC = () => {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<PhoneResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Read API key for potential future use (stored in settings)
  void localStorage.getItem('watcher-numverify-key');

  const formatPhone = (input: string) => {
    const cleaned = input.replace(/\D/g, '');
    if (cleaned.length === 10) return `+1${cleaned}`;
    if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
    return `+${cleaned}`;
  };

  const handleLookup = async () => {
    if (!phone.trim()) return;
    setIsLoading(true);
    setResult(null);

    // Simulate a lookup (in production this would call numverify or similar API)
    await new Promise((r) => setTimeout(r, 1500));

    const cleaned = phone.replace(/\D/g, '');
    setResult({
      number: formatPhone(phone),
      isValid: cleaned.length >= 10,
      country: cleaned.startsWith('1') || cleaned.length === 10 ? 'United States' : 'Unknown',
      carrier: cleaned.length >= 10 ? 'Carrier lookup requires API key' : undefined,
      lineType: 'mobile',
      location: 'Requires carrier lookup API',
      spamLikelihood: 'Unknown - check TrueCaller',
    });
    setIsLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-300 font-medium text-sm">Legal Notice</p>
          <p className="text-amber-400/80 text-xs mt-1">
            Phone lookups must comply with TCPA, CCPA, and other applicable privacy laws. Only look
            up numbers you have a lawful purpose to investigate. Do not use for spam, harassment, or
            illegal purposes.
          </p>
        </div>
      </div>

      {/* Lookup form */}
      <div className="card">
        <div className="card-header">
          <Phone size={18} className="text-yellow-400" />
          <h3 className="section-title">Phone Number Lookup</h3>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="tel"
              placeholder="+1 (555) 000-0000 or international format"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              className="input-field pl-9"
            />
          </div>
          <button onClick={handleLookup} disabled={isLoading || !phone.trim()} className="btn-primary">
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Lookup
          </button>
        </div>

        {/* Result */}
        {result && (
          <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              {result.isValid ? (
                <CheckCircle size={18} className="text-green-400" />
              ) : (
                <XCircle size={18} className="text-red-400" />
              )}
              <span className="font-mono text-lg text-gray-200">{result.number}</span>
              <span className={`badge ml-auto ${result.isValid ? 'badge-green' : 'badge-red'}`}>
                {result.isValid ? 'Valid' : 'Invalid'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Country', value: result.country },
                { label: 'Carrier', value: result.carrier },
                { label: 'Line Type', value: result.lineType },
                { label: 'Spam Risk', value: result.spamLikelihood },
              ].filter((i) => i.value).map(({ label, value }) => (
                <div key={label} className="bg-gray-800 rounded p-2">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-sm text-gray-300 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              * Full carrier and owner data requires NumVerify, TrueCaller, or similar API subscription
            </p>
          </div>
        )}
      </div>

      {/* Quick links with pre-filled search */}
      <div className="card">
        <div className="card-header">
          <Search size={16} className="text-gray-400" />
          <h3 className="section-title">Lookup Services</h3>
          {phone && (
            <span className="ml-auto text-xs text-gray-500">
              Searching: {formatPhone(phone)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PHONE_RESOURCES.map((r) => (
            <a
              key={r.name}
              href={`${r.url}${phone ? encodeURIComponent(formatPhone(phone)) : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-yellow-700/50 transition-all group"
            >
              <Phone size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 group-hover:text-yellow-300 transition-colors">
                  {r.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>
              </div>
              <ExternalLink size={12} className="text-gray-600 group-hover:text-yellow-400 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Format guide */}
      <div className="card">
        <div className="card-header">
          <Phone size={16} className="text-gray-400" />
          <h3 className="section-title">Number Format Guide</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { format: '+1 (555) 867-5309', description: 'US/Canada format' },
            { format: '+44 20 7946 0958', description: 'UK format' },
            { format: '+61 2 9876 5432', description: 'Australia format' },
            { format: '+33 1 23 45 67 89', description: 'France format' },
          ].map(({ format, description }) => (
            <button
              key={format}
              onClick={() => setPhone(format)}
              className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-600 transition-colors text-left"
            >
              <code className="text-sm text-green-400 font-mono">{format}</code>
              <span className="text-xs text-gray-500 ml-auto">{description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PhoneLookup;

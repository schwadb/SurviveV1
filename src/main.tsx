import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import './index.css'
import App from './App.tsx'
import { MonitorsProvider } from './hooks/useMonitors'
import { KeyVaultProvider } from './hooks/useKeyVault'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <KeyVaultProvider>
        <MonitorsProvider>
          <App />
        </MonitorsProvider>
      </KeyVaultProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1a2235',
            color: '#e2e8f0',
            border: '1px solid #374151',
            borderRadius: '0.75rem',
            fontSize: '0.875rem',
          },
          success: { iconTheme: { primary: '#4ade80', secondary: '#1a2235' } },
          error: { iconTheme: { primary: '#f87171', secondary: '#1a2235' } },
        }}
      />
    </BrowserRouter>
  </StrictMode>,
)

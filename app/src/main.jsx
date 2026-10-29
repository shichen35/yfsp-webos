import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { initTvEnv } from './api/luna.js'
import './styles/index.css'

// Learn the transport environment before the first frame: Luna service on the
// device, the dev proxy over HTTP elsewhere. Never throws.
await initTvEnv()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

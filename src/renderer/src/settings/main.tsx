import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SettingsApp from './SettingsApp'
import './settings.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)

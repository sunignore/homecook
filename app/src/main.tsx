import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { requestPersistentStorage } from './db/db';
import './styles/global.css';

// Ask for storage persistence at startup. There is no server copy (ADR-0001),
// so an eviction is permanent loss; this is best-effort and the backup export
// remains the real safety net.
void requestPersistentStorage();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    {/* Opt into the v7 behaviours now so the upgrade is not a behaviour change
        later, and so the console stays clean enough that a real warning stands
        out. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

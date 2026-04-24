import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/globals.css';
import '@/lib/dayjs.js';
import '@/services/i18nService.js';
import { App } from './app/App.jsx';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Missing #root mount node');
}

createRoot(rootElement).render(
    createElement(StrictMode, null, createElement(App))
);

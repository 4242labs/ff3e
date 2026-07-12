import React from 'react'
import ReactDOM from 'react-dom/client'

// Fonts, self-hosted (no external/Google runtime request — works offline).
// Weights match tokens.latest.css: Space Grotesk (heading),
// IBM Plex Sans (body), Geist Mono (mono).
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'

// Import order is load-bearing: the design tokens define the raw palette +
// semantic vars first, the shadcn<->token bridge aliases on top
// of those, then Tailwind's base/components/utilities layers last so
// utility classes can reference the bridge vars.
import '@/tokens.latest.css'
import '@/bridge.css'
import '@/index.css'

import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

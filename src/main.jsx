import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ThemeProvider } from './theme.jsx'
import { MarketStoreProvider } from './store/marketStore.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <MarketStoreProvider>
        <App />
      </MarketStoreProvider>
    </ThemeProvider>
  </React.StrictMode>,
)

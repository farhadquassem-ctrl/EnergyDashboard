import { createContext, useContext, useEffect, useState } from 'react'

// Theme state: 'dark' | 'light'. Dark is the hard default — it's the intended
// primary look — and only an explicit toggle switches to light (persisted in
// localStorage; OS prefers-color-scheme is deliberately NOT consulted).
// index.html applies the saved class before first paint to avoid a flash;
// this provider owns it from then on.

const STORAGE_KEY = 'theme'
const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} })

function initialTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark' // storage blocked (private mode etc.)
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // non-persistable is fine; the session still gets the chosen theme
    }
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

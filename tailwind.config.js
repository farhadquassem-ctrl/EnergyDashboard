/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Near-black canvas + panel surfaces for the dark theme.
        canvas: '#09090b', // zinc-950-ish
        panel: '#18181b', // zinc-900
        panelMuted: '#27272a', // zinc-800
      },
    },
  },
  plugins: [],
}

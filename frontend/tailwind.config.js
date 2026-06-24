/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-code)'],
        telemetry: ['var(--font-telemetry)'],
      },
      colors: {
        primary: {
          50: '#eef6ff',
          100: '#d9ecff',
          300: '#7db7ff',
          400: '#4f9bff',
          500: '#2f7df6',
          600: '#1f63d6',
          700: '#194da8',
        },
        signal: {
          gold: '#d6a84f',
          cyan: '#4fb7d6',
          green: '#35b779',
          amber: '#d99a3d',
          red: '#e15b64',
          violet: '#9b7bf3',
        },
        ops: {
          black: '#050708',
          panel: '#0a0d10',
          raised: '#101418',
          line: '#252b31',
          text: '#f5f7fa',
          muted: '#9aa4af',
          accent: '#2f7df6',
        },
      },
    },
  },
  plugins: [],
}

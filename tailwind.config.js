/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-stack-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-stack-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-stack-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'fluid-title': ['clamp(2.5rem, 22vw, 22rem)', { lineHeight: '0.9', letterSpacing: '-0.05em' }],
        'fluid-subtitle': ['clamp(1.25rem, 8vw, 6rem)', { lineHeight: '0.85', letterSpacing: '-0.05em' }],
      },
      letterSpacing: {
        tighter: '-0.05em',
      },
      lineHeight: {
        tight: '0.85',
        display: '0.9',
      },
      colors: {
        theme: {
          background: 'var(--theme-background)',
          primary: 'var(--theme-primary)',
          accent: 'var(--theme-accent)',
        },
      },
    },
  },
  plugins: [],
}

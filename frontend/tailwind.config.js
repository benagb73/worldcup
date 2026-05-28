/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body:    ['var(--font-body)',    'sans-serif'],
      },
      colors: {
        pitch:  '#1a3a2a',
        gold:   '#c9a84c',
        cream:  '#f5f0e8',
        carbon: '#0d0d0d',
        slate:  '#1c1c2e',
      },
      keyframes: {
        'score-in': {
          '0%':   { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)',      opacity: '1' },
        },
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(201,168,76,0.4)' },
          '50%':       { boxShadow: '0 0 0 12px rgba(201,168,76,0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
      },
      animation: {
        'score-in':   'score-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
        'pulse-gold': 'pulse-gold 2s ease-in-out infinite',
        shimmer:      'shimmer 1.5s linear infinite',
      },
    },
  },
  plugins: [],
}

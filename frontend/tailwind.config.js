/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body:    ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Backgrounds — deep navy/charcoal scale
        ink:     '#05060d',  // page base
        navy: {
          900: '#070a1a',
          800: '#0b1024',
          700: '#101638',
          600: '#1a2350',
          500: '#243070',
        },
        // Accents — gold/amber
        gold:    '#f5b942',
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        // Live indicator — vivid red/amber
        live:    '#ef4444',
        // Text
        cream:   '#f7f5ef',
        // Surface helper (kept for back-compat in case any utility class remains)
        pitch:   '#0e3a26',
        carbon:  '#05060d',
        slate:   '#0b1024',
      },
      backgroundImage: {
        'hero-gradient':
          'radial-gradient(ellipse at top, rgba(36,48,112,0.35) 0%, rgba(7,10,26,0) 60%), linear-gradient(180deg, #070a1a 0%, #05060d 100%)',
        'panel-gradient':
          'linear-gradient(155deg, rgba(36,48,112,0.18) 0%, rgba(11,16,36,0.45) 60%, rgba(7,10,26,0.6) 100%)',
        'gold-gradient':
          'linear-gradient(135deg, #fbbf24 0%, #f5b942 40%, #d97706 100%)',
        'live-gradient':
          'linear-gradient(135deg, #ef4444 0%, #f59e0b 100%)',
        'pitch-gradient':
          'linear-gradient(180deg, #0c4a2a 0%, #0a3a22 50%, #08321d 100%)',
      },
      boxShadow: {
        'gold':    '0 8px 32px -8px rgba(245,185,66,0.35)',
        'gold-lg': '0 16px 48px -12px rgba(245,185,66,0.45)',
        'panel':   '0 8px 32px -12px rgba(0,0,0,0.6)',
        'inset-top': 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
      },
      keyframes: {
        'score-in': {
          '0%':   { transform: 'translateY(-60%) scale(0.6)', opacity: '0' },
          '60%':  { transform: 'translateY(8%) scale(1.05)',  opacity: '1' },
          '100%': { transform: 'translateY(0) scale(1)',       opacity: '1' },
        },
        'pulse-live': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.55)' },
          '50%':       { boxShadow: '0 0 0 14px rgba(239,68,68,0)' },
        },
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245,185,66,0.5)' },
          '50%':       { boxShadow: '0 0 0 12px rgba(245,185,66,0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'fade-up': {
          '0%':   { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',     opacity: '1' },
        },
        'ticker': {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'score-in':   'score-in 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
        'pulse-live': 'pulse-live 1.8s ease-in-out infinite',
        'pulse-gold': 'pulse-gold 2s ease-in-out infinite',
        shimmer:      'shimmer 2.2s linear infinite',
        'fade-up':    'fade-up 0.4s ease-out both',
        ticker:       'ticker 40s linear infinite',
      },
    },
  },
  plugins: [],
}

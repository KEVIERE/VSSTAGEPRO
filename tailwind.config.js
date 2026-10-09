/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Logic Pro dark theme palette
        logic: {
          // Backgrounds — near-black grays
          bg: '#1a1a1a',
          'bg-deep': '#0e0e0e',
          'bg-panel': '#232323',
          'bg-panel-light': '#2d2d2d',
          'bg-elevated': '#3a3a3a',
          // Borders
          border: '#3a3a3a',
          'border-light': '#4a4a4a',
          'border-dark': '#111111',
          // Text
          text: '#e8e8e8',
          'text-dim': '#999999',
          'text-muted': '#666666',
          // Accent — Logic's blue
          accent: '#0a84ff',
          'accent-hover': '#3d9bff',
          'accent-dim': '#0066cc',
          // LCD display
          lcd: {
            bg: '#1c1c1c',
            text: '#d4d4d4',
            amber: '#ff9f0a',
            green: '#30d158',
            red: '#ff453a',
            yellow: '#ffd60a',
          },
          // Track colors
          track: {
            audio: '#5b8db8',
            midi: '#b85b8d',
            subgroup: '#5bb87a',
            master: '#b85b5b',
          },
          // Faders / meters
          meter: {
            green: '#30d158',
            yellow: '#ffd60a',
            red: '#ff453a',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        stage: ['"Barlow Semi Condensed"', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'logic-inset': 'inset 0 1px 2px rgba(0,0,0,0.6)',
        'logic-raised': '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
      },
      transitionTimingFunction: {
        'logic': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

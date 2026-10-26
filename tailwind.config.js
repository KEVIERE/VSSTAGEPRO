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
        // Paleta extraída do CSS real de apple.com/logic-pro (overview.built.css):
        // mesmo azul de link/CTA, cinzas de texto secundário e botões neutros que a Apple usa.
        apple: {
          bg: '#000000',
          surface: '#1d1d1f',
          'surface-light': '#272729',
          'surface-lighter': '#37373a',
          text: '#f5f5f7',
          'text-secondary': '#86868b',
          'text-tertiary': '#6e6e73',
          border: 'rgba(255,255,255,0.14)',
          blue: '#0071e3',
          'blue-hover': '#0076df',
          'blue-active': '#006edb',
          link: '#2997ff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        stage: ['"Barlow Semi Condensed"', 'Inter', 'system-ui', 'sans-serif'],
        // Stack oficial da Apple: em macOS/iOS, -apple-system e BlinkMacSystemFont
        // resolvem para a fonte do sistema (SF Pro) automaticamente — mesma fonte
        // usada em apple.com, sem precisar hospedar o arquivo proprietário.
        apple: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"',
          '"SF Pro Icons"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif',
        ],
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
        // Easing real usado nas transições de opacidade/fade do apple.com
        'apple': 'cubic-bezier(0.33, 1, 0.68, 1)',
        'apple-spring': 'cubic-bezier(0, 0, 0.5, 1)',
      },
    },
  },
  plugins: [],
};

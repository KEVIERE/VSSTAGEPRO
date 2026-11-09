/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta do programa. Visual de mesa analógica: painel de aço pintado em grafite
        // levemente azulado, e textos em creme, como a serigrafia impressa numa mesa de som.
        logic: {
          // Fundos: aço pintado (do rebaixo mais fundo ao botão mais saltado)
          bg: '#1b1e22',
          'bg-deep': '#111316',
          'bg-panel': '#24282d',
          'bg-panel-light': '#2d3238',
          'bg-elevated': '#383d44',
          // Bordas
          border: '#3b4148',
          'border-light': '#4b525a',
          'border-dark': '#0b0d0f',
          // Texto: serigrafia creme
          text: '#e7e2d6',
          'text-dim': '#a7a297',
          'text-muted': '#6f6c66',
          // Accent — Logic's blue
          accent: '#0a84ff',
          'accent-hover': '#3d9bff',
          'accent-dim': '#0066cc',
          // Displays e LEDs
          lcd: {
            bg: '#0c0e0d',
            text: '#d8d3c6',
            amber: '#ffab1f',
            green: '#3ee26e',
            red: '#ff4136',
            yellow: '#ffd83d',
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
            green: '#3ee26e',
            yellow: '#ffd83d',
            red: '#ff4136',
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

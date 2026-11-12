/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta do programa. Visual de mesa analógica: painel de aço pintado em grafite
        // levemente azulado, e textos em creme, como a serigrafia impressa numa mesa de som.
        // As cores vêm de variáveis (src/index.css) para as skins poderem trocar (Visualizar >
        // Skins). Os valores padrão são os mesmos de sempre: a skin Analógica fica idêntica.
        logic: {
          // Fundos: aço pintado (do rebaixo mais fundo ao botão mais saltado)
          bg: 'rgb(var(--lg-bg) / <alpha-value>)',
          'bg-deep': 'rgb(var(--lg-bg-deep) / <alpha-value>)',
          'bg-panel': 'rgb(var(--lg-bg-panel) / <alpha-value>)',
          'bg-panel-light': 'rgb(var(--lg-bg-panel-light) / <alpha-value>)',
          'bg-elevated': 'rgb(var(--lg-bg-elevated) / <alpha-value>)',
          // Bordas
          border: 'rgb(var(--lg-border) / <alpha-value>)',
          'border-light': 'rgb(var(--lg-border-light) / <alpha-value>)',
          'border-dark': 'rgb(var(--lg-border-dark) / <alpha-value>)',
          // Texto: serigrafia creme
          text: 'rgb(var(--lg-text) / <alpha-value>)',
          'text-dim': 'rgb(var(--lg-text-dim) / <alpha-value>)',
          'text-muted': 'rgb(var(--lg-text-muted) / <alpha-value>)',
          // Accent — Logic's blue
          accent: 'rgb(var(--lg-accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--lg-accent-hover) / <alpha-value>)',
          'accent-dim': 'rgb(var(--lg-accent-dim) / <alpha-value>)',
          // Displays e LEDs
          lcd: {
            bg: 'rgb(var(--lg-lcd-bg) / <alpha-value>)',
            text: 'rgb(var(--lg-lcd-text) / <alpha-value>)',
            amber: 'rgb(var(--lg-lcd-amber) / <alpha-value>)',
            green: 'rgb(var(--lg-lcd-green) / <alpha-value>)',
            red: 'rgb(var(--lg-lcd-red) / <alpha-value>)',
            yellow: 'rgb(var(--lg-lcd-yellow) / <alpha-value>)',
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

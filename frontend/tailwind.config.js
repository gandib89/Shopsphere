export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--color-paper) / <alpha-value>)',
        'paper-raised': 'rgb(var(--color-surface) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--color-muted) / <alpha-value>)',
        brass: {
          DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)',
          dark: 'rgb(var(--color-brand-strong) / <alpha-value>)',
          light: 'rgb(var(--color-brand-soft) / <alpha-value>)',
        },
        accent: {
          DEFAULT: '#F59E0B',
          dark: '#B45309',
        },
        graphite: 'rgb(var(--color-graphite) / <alpha-value>)',
        hairline: 'rgb(var(--color-line) / <alpha-value>)',
        seal: 'rgb(var(--color-danger) / <alpha-value>)',
        moss: 'rgb(var(--color-success) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Aptos Display', 'Segoe UI', 'system-ui', 'sans-serif'],
        sans: ['Aptos', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderColor: {
        border: '#e5e7eb',
        DEFAULT: '#E2E8F0',
      },
      outlineColor: {
        ring: '#0F766E',
      },
      transitionTimingFunction: {
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      boxShadow: {
        float: '0 18px 45px rgba(26, 31, 29, 0.14)',
      },
    },
  },
  plugins: [],
};

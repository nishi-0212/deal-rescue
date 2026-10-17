/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        panel: c('panel'),
        panel2: c('panel2'),
        hover: c('hover'),
        line: c('ink'),
        text: c('text'),
        strong: c('strong'),
        body: c('body'),
        muted: c('muted'),
        faint: c('faint'),
        dim: c('dim'),
        sky: { DEFAULT: c('sky'), ink: c('sky-ink') },
        mist: { DEFAULT: c('mist'), ink: c('mist-ink') },
        blush: { DEFAULT: c('blush'), ink: c('blush-ink') },
        rose: { DEFAULT: c('rose'), ink: c('rose-ink') },
        butter: { DEFAULT: c('butter'), ink: c('butter-ink') },
        mint: { DEFAULT: c('mint'), ink: c('mint-ink') },
        onpastel: '#0b1520',
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      transitionTimingFunction: { out: 'cubic-bezier(.2,.8,.2,1)' },
      boxShadow: {
        pop: '0 30px 60px -24px rgb(var(--shadow) / 0.55)',
        glow: '0 0 0 1px rgb(var(--sky) / 0.5), 0 10px 30px -10px rgb(var(--sky) / 0.55)',
      },
    },
  },
  plugins: [],
}
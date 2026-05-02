/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // 8px-based spacing scale per global rules. Class names match pixel
      // values (e.g. p-24 → 24px) instead of Tailwind's default scale.
      spacing: {
        0: '0px',
        2: '2px',
        4: '4px',
        8: '8px',
        12: '12px',
        16: '16px',
        20: '20px',
        24: '24px',
        32: '32px',
        40: '40px',
        48: '48px',
        56: '56px',
        64: '64px',
        80: '80px',
        96: '96px',
        120: '120px',
        160: '160px',
        200: '200px',
        240: '240px',
        320: '320px',
        400: '400px',
        480: '480px',
        560: '560px',
        640: '640px',
        720: '720px',
        800: '800px'
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}

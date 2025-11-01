/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: "#2563EB",       // your main blue
          blueHover: "#1D4ED8",  // hover version
          bg: "#0B0E19",         // dark background
          card: "#121212",       // login card background
          text: "#FFFFFF",       // white text
          muted: "#9CA3AF",      // muted gray text
        },
      },
    },
  },
  plugins: [],
};

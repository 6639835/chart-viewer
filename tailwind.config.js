/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "efb-dark": "#1a1a1a",
        "efb-darker": "#0f0f0f",
        "efb-blue": "#2563eb",
        "efb-blue-hover": "#1d4ed8",
      },
    },
  },
  plugins: [],
};

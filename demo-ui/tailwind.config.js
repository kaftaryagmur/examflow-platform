/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        page: "#f6f8fb",
      },
      boxShadow: {
        panel: "0 12px 34px rgba(15, 23, 42, 0.07)",
      },
    },
  },
  plugins: [],
};

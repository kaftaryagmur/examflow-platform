/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f8fafc",
        muted: "#94a3b8",
        "space-purple": "#090616",
        "space-panel": "#121026",
        "space-line": "rgba(148, 163, 184, 0.22)",
        "cyber-purple": "#8b5cf6",
        "neon-cyan": "#06b6d4",
        "neon-magenta": "#ec4899",
        "neon-green": "#10b981",
        "neon-amber": "#f59e0b",
        danger: "#fb7185",
      },
      boxShadow: {
        panel: "0 24px 70px rgba(0, 0, 0, 0.38)",
        "neon-purple": "0 0 26px rgba(139, 92, 246, 0.36)",
        "neon-cyan": "0 0 22px rgba(6, 182, 212, 0.35)",
        "neon-green": "0 0 22px rgba(16, 185, 129, 0.32)",
      },
    },
  },
  plugins: [],
};

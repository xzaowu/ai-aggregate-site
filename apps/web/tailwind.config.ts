import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17201b",
        leaf: "#1f8a5b",
        saffron: "#c78418",
        mist: "#eef4f1"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(23, 32, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;

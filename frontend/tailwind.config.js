/** @type {import('tailwindcss').Config} */

// Couleurs pilotées par des variables CSS (index.css) : chaque teinte a sa
// variante claire et sombre, comme les couleurs système d'iOS.
const v = (nom) => `rgb(var(--${nom}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: v("blue"), dark: v("blue") },
        ios: {
          blue: v("blue"),
          green: v("green"),
          red: v("red"),
          orange: v("orange"),
          yellow: v("yellow"),
          indigo: v("indigo"),
          purple: v("purple"),
          pink: v("pink"),
          teal: v("teal"),
          cyan: v("cyan"),
          mint: v("mint"),
          brown: v("brown"),
          gray: v("gray"),
        },
        // Fonds : page groupée, carte, carte imbriquée
        fond: v("bg"),
        surface: { DEFAULT: v("surface"), 2: v("surface-2") },
        // Textes : principal, secondaire, tertiaire
        label: { DEFAULT: v("label"), 2: "rgb(var(--label-2) / 0.6)", 3: "rgb(var(--label-3) / 0.3)" },
        // Remplissages gris translucides (champs, segments, boutons gris)
        remplissage: "rgb(var(--fill) / var(--fill-a))",
        separateur: "rgb(var(--sep) / var(--sep-a))",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', '"SF Pro Display"', "Inter", "system-ui", "sans-serif"],
        rounded: ['"SF Pro Rounded"', "-apple-system", "BlinkMacSystemFont", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        carte: "22px",
      },
    },
  },
  plugins: [],
};

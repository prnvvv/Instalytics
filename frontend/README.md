# Instalytics frontend

React 19 + TypeScript + Vite + Tailwind CSS v4, with the shadcn/ui project structure
(`components.json`, `@/components/ui`, `@/lib/utils`).

## Scripts

```bash
npm install
npm run dev      # local dev server
npm run lint     # oxlint
npm test         # vitest (jsdom + Testing Library)
npm run build    # typecheck + production build
```

## Structure

```
src/
  components/ui/   shadcn-style components (kiln-pixel-heat-hero.tsx is the landing hero)
  pages/           route-level pages (LandingPage)
  lib/utils.ts     cn() helper
  test/setup.ts    jsdom mocks for ResizeObserver, matchMedia and canvas
```

The `@` alias points at `src/` (see `vite.config.ts` and `tsconfig.app.json`).

## Notes

- The landing hero loads its typefaces (Archivo, Handjet, Host Grotesk, Instrument Serif, Doto,
  Martian Mono) from Google Fonts. Self-hosting them would avoid that third-party request.
- Never put real Instagram exports in this repository or in test fixtures.

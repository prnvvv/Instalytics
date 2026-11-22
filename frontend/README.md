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
  app/             application shell and routes (/app/*)
  features/        upload, dashboard, lists, history, settings
  data/            session, snapshot and preference state
  lib/             parser, ZIP reader, analytics, storage, CSV (framework-free, unit-tested)
  components/dots/ dot-matrix numerals and pixel charts
  components/ui/   shadcn-style components (kiln-pixel-heat-hero.tsx is the landing hero)
  components/landing/ landing page sections
  pages/           LandingPage
  styles/app.css   application theme
  test/setup.ts    jsdom mocks for ResizeObserver, matchMedia and canvas
```

See `docs/frontend/architecture.md`. Exports are read and analysed in the browser; nothing is uploaded.
In development the Vite server proxies `/api` to the backend on `:8000` (see `docs/setup/local-development.md`
and `.env.example`); `scripts/dev.ps1` starts both servers in one command.

The `@` alias points at `src/` (see `vite.config.ts` and `tsconfig.app.json`).

## Notes

- The landing hero loads its typefaces (Archivo, Handjet, Host Grotesk, Instrument Serif, Doto,
  Martian Mono) from Google Fonts. Self-hosting them would avoid that third-party request.
- Never put real Instagram exports in this repository or in test fixtures.

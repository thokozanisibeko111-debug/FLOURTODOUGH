# Flour to Dough — Ops Console (v3)

A single-page React app for your bakery operations:
- Daily Sales (paste driver messages)
- Accounts Receivable (click a customer to view ledger)
- Consolidated Day (paste end-of-day and auto-fill)
- Production, Raw Materials
- Expenses, Cash Movements
- Reports

## Run locally
1. Install Node.js 18+.
2. In a terminal:
   ```bash
   npm install
   npm run dev
   ```
   Open the URL it prints.

## Build for production
```bash
npm run build
npm run preview
```

## Deploy (pick one)
- **Vercel**: Import this folder, it auto-detects Vite.
- **Netlify**: Set build command `npm run build` and publish dir `dist`.
- **GitHub Pages**: `npm run build` then publish `dist/`.
- **Firebase Hosting**: `npm run build` then `firebase deploy`.
- **Render/Surge/etc.**: Upload the `dist` folder.

## Editing
Open `src/App.jsx`. Make changes, save, and your dev server hot-reloads.
You can also ask ChatGPT to modify features; I’ll update this file and
re-export a new ZIP for you.

Data is stored in the browser (localStorage).

# Interview Question Sessions Website

Astro site for publishing generated interview-prep question sessions from the parent notes vault.

## Workflow

```bash
npm install
npm run sync
npm run dev
npm run build
npm run deploy
```

`npm run sync` copies generated Markdown from the parent `question_sessions/` folder into `content/question_sessions/`.

The sync intentionally excludes:

- `website/`
- `index.generated.md`
- `prompts.generated.md`

The sync also strips `Chat Log` sections from the copied Markdown. The original notes keep their full chat history; only the publishable copy is cleaned.

## Publishing

This folder is intended to be its own Git repository. Keep the parent notes vault private and push only this `website/` repository to GitHub.

Cloudflare Workers deployment uses `wrangler.jsonc` and serves the static Astro build from `dist/`.

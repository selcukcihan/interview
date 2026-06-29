# Interview

Interview is a public collection of software engineering interview notes, organized as question-focused study pages.

The site is built for quick review: pick a topic, browse the questions in that area, and open the notes that explain the answer in practical terms. The current collection covers systems and backend topics such as Linux, containers, Kubernetes, networking, WebSockets, security, PostgreSQL, and database internals.

## Website

The project is an Astro static site styled as a compact documentation site. It includes:

- Topic and subtopic index pages
- Markdown-based question notes
- Light, dark, and auto theme modes
- Mobile navigation with a full topic drawer
- Search across topics and question titles

## Local Development

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Build the site:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment

The site is configured for Cloudflare Workers static assets through `wrangler.jsonc`.

Deploy with:

```bash
npm run deploy
```

## Content

The published pages are generated from Markdown notes and cleaned during the build workflow so the website only contains reader-facing material.

## License

Copyright © Selçuk Cihan. All rights reserved.

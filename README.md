# Stylechin AI Stylist

A Persian, right-to-left AI personal styling website powered by Cloudflare Workers AI.

## AI models

- Styling and outfit recommendation: `@cf/google/gemma-4-26b-a4b-it`
- Outfit image generation: `@cf/leonardo/phoenix-1.0`

## Features

- Persian-first, responsive interface.
- Optional women's clothing, men's clothing, or no preference selection.
- Optional height and usual clothing size inputs, used only for garment fit and length suggestions.
- Clothing-fit preference instead of body scoring or body-shape judgments.
- The AI stylist itself chooses from a broad trouser catalog using occasion, season, style, height, usual clothing size, and fit preference; jeans are not the default.
- Varied top garments, including shirts, T-shirts, polo shirts, blouses, sweaters, sweatshirts, hoodies, overshirts, and cardigans.
- Structured outfit descriptions, plus a flat-lay image prompt based on the exact generated garments.
- Phoenix negative prompts to reduce unwanted denim, extra clothes, and mismatched outfit parts; the server correctly reads Phoenix 1.0 raw JPEG responses (not only JSON/base64).
- Cloudflare secrets stay server-side.

## Local setup

```bash
npm install
```

Copy `.env.example` to `.env`, then fill in the Cloudflare account ID and API token.

```bash
npm start
```

Open `http://localhost:3000`.

## Render

Use `npm install` as the build command and `npm start` as the start command. Set the four environment variables listed in `.env.example` inside Render's Environment page. Do not upload `.env` to GitHub.

See `README-DEPLOY-FA.md` for Persian deployment instructions.

## Notes

The pants selector is intentionally removed from the form. The language model returns a validated `items.bottomType` ID from the server-side trouser catalog; the same selected trouser is then used in the image prompt.


Cloudflare Workers AI Free allocation is 10,000 Neurons per day. Text and image requests share this daily allocation. Generated images may still differ in small details from the written outfit; image models cannot guarantee exact product-level rendering.

# Writing Sample Screener

A Next.js app that analyses an image of handwriting for surface-level indicators associated with dyslexia, using the Gemini API.

Important: this is a screening aid, not a diagnostic tool. Dyslexia can only be identified through a full psychoeducational assessment by a qualified professional. The app is explicit about this in its UI and in the model prompt.

## What it detects

The model is prompted to look only for concrete, visible evidence of research-associated indicators:

- Letter reversals and inversions (b/d, p/q, m/w, n/u)
- Transpositions (was/saw, left/felt)
- Phonetic spelling (enuf for enough)
- Omitted letters, syllables, or words
- Inconsistent case, spacing, letter size, and baseline drift
- The same word spelled differently in one sample
- Homophone confusion

Each indicator is returned with the specific evidence found and a strength rating. The model is instructed to be conservative and to flag when reversals are likely developmentally normal (young writers).

## Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env.local` in the project root

```
GEMINI_API_KEY=your_key_here
```

3. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000, upload a photo of a writing sample, and click Analyse.

## Architecture

- `app/page.jsx` - client component. Handles drag-and-drop upload, base64 encoding, and renders the results as a ruled exercise-book sheet.
- `app/api/analyze/route.js` - server route. Validates the image, sends it to Gemini with a structured system prompt, parses the JSON response, and returns it. The API key never reaches the browser.
- `app/globals.css` - design system. Exercise-book motif: ruled lines, red margin, indicator cards colour-coded by strength.

## Extending it

Ideas that map well onto a screening-engine design:

- Multi-sample mode: aggregate indicators across several uploads before showing a screening level, since one sample is weak evidence
- Age input: pass the writer's age to the prompt so developmental norms are weighted properly
- Export: generate a PDF report for referral to an assessor
- Error taxonomy: log indicator categories over time per student to track intervention progress

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { analyzeWriting } from "../../../lib/nlp/analyze";
import { persistErrorAnalysis } from "../../../lib/nlp/persist";
import { createClient } from "../../../lib/supabase/server";

// onnxruntime-node needs the Node runtime; the Edge runtime cannot load it.
export const runtime = "nodejs";
export const maxDuration = 120;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SYSTEM_PROMPT = `You are a literacy screening assistant used by educators. You analyse images of handwritten or typed writing samples for surface-level indicators that are RESEARCH-ASSOCIATED with dyslexia. You are NOT a diagnostic tool and you must never claim someone has or does not have dyslexia.

Indicators to look for in the writing sample:
1. Letter reversals or inversions (b/d, p/q, m/w, n/u)
2. Letter or number transpositions within words (e.g. "was" written as "saw", "left" as "felt")
3. Phonetic spelling that ignores conventional orthography (e.g. "enuf" for "enough")
4. Omitted letters, syllables, or whole words
5. Inconsistent letter case mid-word
6. Irregular spacing between words or crowded/overlapping letters
7. Inconsistent letter size or drifting baseline
8. The same word spelled differently in the same sample
9. Homophone confusion (their/there, to/too)
10. Unusual letter formation or heavy pencil pressure artefacts (if visible)

Respond ONLY with a JSON object, no markdown fences, no preamble, in exactly this shape:
{
  "isWritingSample": boolean,
  "transcription": "your best-effort transcription of the visible text",
  "verdict": "likely" | "unlikely",
  "likelihoodScore": number from 0 to 100,
  "verdictReasoning": "1-2 sentences explaining why the sample leans this way",
  "indicators": [
    {
      "name": "short indicator name",
      "category": "reversal | transposition | phonetic_spelling | omission | case | spacing | sizing | inconsistency | homophone | formation",
      "evidence": "the specific word(s) or feature(s) in the image that show this, quoted where possible",
      "strength": "weak | moderate | strong"
    }
  ],
  "summary": "2-3 sentence plain-language summary written for a parent or teacher",
  "importantCaveats": [
    "list of caveats relevant to THIS sample, e.g. sample too short, writer may be very young so reversals are developmentally normal, image quality limits analysis"
  ]
}

Rules:
- If the image is not a writing sample, set isWritingSample to false, leave indicators empty, set verdict to "unlikely" and likelihoodScore to 0, and explain in summary.
- verdict is your overall lean: "likely" means the sample shows enough dyslexia-associated patterns that a formal assessment is worth pursuing, "unlikely" means it does not.
- likelihoodScore expresses how strongly the evidence supports the verdict. Anchor it to evidence density: 0-30 means little or no indicator evidence, 30-55 means weak or ambiguous evidence, 55-75 means clear evidence across 2-3 categories, 75-100 means strong convergent evidence across 4+ categories. A verdict of "likely" should normally have a score of 55 or above.
- The score is an evidence-strength estimate from one sample, NOT a clinical probability that the writer has dyslexia. Never present it otherwise.
- Young children (roughly under 7) commonly reverse letters as part of normal development. If the writing appears to be from a young child, lower the score, weight this heavily in caveats, and only output "likely" if there is evidence beyond reversals alone.
- Be conservative. Only report an indicator when you can point to concrete evidence in the image.`;

export async function POST(req) {
  try {
    // Require an authenticated user before spending any Gemini quota.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "You must be signed in to analyse a sample." },
        { status: 401 },
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Server is missing GEMINI_API_KEY. Add it to .env.local and restart.",
        },
        { status: 500 },
      );
    }

    // The client posts multipart/form-data carrying the raw file. Base64 in a
    // JSON body cost a third more bytes on the wire for no benefit: Gemini
    // needs the encoding, but it can be done here, off the network path.
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data with an image field." },
        { status: 400 },
      );
    }

    const image = form.get("image");
    if (!image || typeof image === "string") {
      return NextResponse.json(
        { error: "Request must include an image file." },
        { status: 400 },
      );
    }

    const mediaType = image.type;
    if (!ALLOWED_TYPES.includes(mediaType)) {
      return NextResponse.json(
        {
          error: `Unsupported image type ${mediaType || "unknown"}. Use JPEG, PNG, WebP, or GIF.`,
        },
        { status: 400 },
      );
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image is larger than 8 MB. Please use a smaller image." },
        { status: 413 },
      );
    }

    const rawAge = Number(form.get("writerAge"));
    const writerAge =
      Number.isFinite(rawAge) && rawAge > 0 && rawAge < 120 ? Math.round(rawAge) : null;

    const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mediaType,
                data: imageBase64,
              },
            },
            {
              text: "Analyse this writing sample for dyslexia-associated indicators. Respond with the JSON object only.",
            },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        maxOutputTokens: 4000,
      },
    });

    const text = response.text;
    if (!text) {
      return NextResponse.json(
        { error: "Model returned no text content." },
        { status: 502 },
      );
    }

    const cleaned = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Model response was not valid JSON.", raw: cleaned },
        { status: 502 },
      );
    }

    // Problem Statement 4: run the error-pattern analyser over the recovered
    // text. The vision model reports what it sees in the image; this reports
    // what the spelling errors are made of and which profile they fit.
    let errorAnalysis = null;
    if (parsed.isWritingSample && typeof parsed.transcription === "string") {
      const analysis = await analyzeWriting(parsed.transcription, {
        writerAge,
        transcribed: true,
      });
      if (analysis.ok) errorAnalysis = analysis;
    }

    // Persist the screening result for the signed-in user. A DB failure
    // should not block returning the analysis, so we only log it.
    const { data: screening, error: dbError } = await supabase
      .from("screenings")
      .insert({
        user_id: user.id,
        is_writing_sample: parsed.isWritingSample ?? null,
        verdict: parsed.verdict ?? null,
        likelihood_score: parsed.likelihoodScore ?? null,
        transcription: parsed.transcription ?? null,
        summary: parsed.summary ?? null,
        result: parsed,
      })
      .select("id")
      .maybeSingle();

    if (dbError) {
      console.error("Failed to save screening:", dbError.message);
    }

    if (errorAnalysis) {
      await persistErrorAnalysis(supabase, {
        userId: user.id,
        source: "image",
        sampleText: parsed.transcription,
        writerAge,
        analysis: errorAnalysis,
        screeningId: screening?.id ?? null,
      });
    }

    return NextResponse.json({ ...parsed, errorAnalysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

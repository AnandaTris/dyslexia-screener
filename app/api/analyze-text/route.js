import { NextResponse } from "next/server";
import { analyzeWriting } from "../../../lib/nlp/analyze";
import { createClient } from "../../../lib/supabase/server";
import { persistErrorAnalysis } from "../../../lib/nlp/persist";

// The NLP pipeline runs in-process and needs the Node runtime for
// onnxruntime-node; the Edge runtime cannot load the native binary.
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CHARS = 20_000;

export async function POST(req) {
  try {
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

    const body = await req.json().catch(() => null);
    if (!body || typeof body.text !== "string") {
      return NextResponse.json(
        { error: "Request must include a text field." },
        { status: 400 },
      );
    }

    const text = body.text.trim();
    if (text.length < 20) {
      return NextResponse.json(
        { error: "Paste at least 20 characters of the student's writing." },
        { status: 400 },
      );
    }
    if (text.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `Sample is longer than ${MAX_CHARS} characters. Analyse it in sections.` },
        { status: 400 },
      );
    }

    const writerAge =
      Number.isFinite(body.writerAge) && body.writerAge > 0 && body.writerAge < 120
        ? Math.round(body.writerAge)
        : null;

    const analysis = await analyzeWriting(text, { writerAge, transcribed: false });

    if (!analysis.ok) {
      return NextResponse.json({ error: analysis.error }, { status: 400 });
    }

    await persistErrorAnalysis(supabase, {
      userId: user.id,
      source: "text",
      sampleText: text,
      writerAge,
      analysis,
    });

    return NextResponse.json({ text, analysis });
  } catch (err) {
    // Kept server-side for the same reason as /api/analyze: an unhandled error
    // here comes from the NLP stack or Supabase and can name paths and hosts.
    console.error("Error-pattern analysis failed:", err);
    return NextResponse.json(
      { error: "Could not analyse the sample. Please try again." },
      { status: 500 },
    );
  }
}

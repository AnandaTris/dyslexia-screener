import { redirect } from "next/navigation";

// A journey with no student is exactly what per-student records removed. There
// is no correct thing to show here any more, so send the therapist to pick a
// student rather than guessing which one they meant.
export default function JourneyPage() {
  redirect("/students");
}

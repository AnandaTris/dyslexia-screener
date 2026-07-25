import { Zilla_Slab, Public_Sans } from "next/font/google";
import "./globals.css";

const zilla = Zilla_Slab({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display"
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata = {
  title: "Writing Sample Screener",
  description:
    "Screens photos and PDFs of handwriting for indicators associated with dyslexia. A screening aid, not a diagnostic tool."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${zilla.variable} ${publicSans.variable}`}>
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Heebo, Rubik } from "next/font/google";
import "./globals.css";
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-heebo",
});
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-rubik",
});
export const metadata: Metadata = {
  title: "חוגגים את אנאל | אישורי הגעה",
  description:
    "הבריתה של אנאל · 18.10.2026 בשעה 19:30 · אולם אצולת העמק, עפולה. נשמח לראותכם, עדי ועדן תמיר.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf6f0",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${rubik.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          דילוג לתוכן
        </a>
        {children}
      </body>
    </html>
  );
}

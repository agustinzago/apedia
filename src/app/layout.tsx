import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Kalam, Patrick_Hand } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";
import { SITE_URL } from "./site-url";

const kalam = Kalam({
  variable: "--font-kalam",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const patrickHand = Patrick_Hand({
  variable: "--font-patrick-hand",
  weight: "400",
  subsets: ["latin"],
});

// Search wording on purpose: people look for "AI teacher" and "online course".
const description =
  "Learn anything with a personal AI teacher. Say what you want to learn and why, and get a short online course built around you: bite-size lessons, real sources, quizzes.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Apedia: learn anything with a personal AI teacher",
  description,
  applicationName: "Apedia",
  alternates: { canonical: "./" },
  openGraph: { type: "website", siteName: "Apedia", locale: "en_US", url: "./" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${kalam.variable} ${patrickHand.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}

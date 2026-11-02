import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ShopShell } from "@/components/shop-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "B2B Shop",
    template: "%s · B2B Shop",
  },
  description: "B2B Commerce Lab customer shop (development preview)",
  // A development preview must not be indexed by search engines
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-sm">
        <ShopShell>{children}</ShopShell>
      </body>
    </html>
  );
}

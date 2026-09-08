import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PixelShop — The AI Shopping Network",
  description: "A 24/7 AI-generated home shopping channel. Submit any product URL and watch it go live on air.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <ConvexClientProvider>
        <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
          {children}
        </body>
      </ConvexClientProvider>
    </html>
  );
}

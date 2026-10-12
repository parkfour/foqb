import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/providers/service-worker-registration";
import { OnlineStatusProvider } from "@/components/providers/online-status-provider";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { DemoBanner } from "@/components/ui/demo-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FOQB — Free, Open, Quality Bookkeeping",
  description: "Free, Open, Quality Bookkeeping — a multi-tenant double-entry accounting PWA",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Rendered per request, so pages read this instance's settings (operator
// details, DEMO_MODE) from its environment at runtime rather than whatever
// was set when the image was built.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#0f172a",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        <DemoBanner />
        <OnlineStatusProvider>
          <OfflineBanner />
          {children}
        </OnlineStatusProvider>
      </body>
    </html>
  );
}

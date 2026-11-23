import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Latin + Cyrillic: client names and bank details include Cyrillic (Guide §3).
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = { title: { default: "Paypure", template: "%s · Paypure" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * The device's zone reaches the server in a `tz` cookie so SSR and the browser render the same
 * strings (06 §3.3). If it was missing or changed, reload once.
 */
const tzScript = `(function(){try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;var m=document.cookie.match(/(?:^|; )tz=([^;]*)/);var c=m?decodeURIComponent(m[1]):null;if(c!==z){document.cookie="tz="+encodeURIComponent(z)+"; path=/; max-age=31536000; samesite=lax";if(!sessionStorage.getItem("pp_tz_reload")){sessionStorage.setItem("pp_tz_reload","1");location.reload();}}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: tiny inline bootstrap script */}
        <script dangerouslySetInnerHTML={{ __html: tzScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

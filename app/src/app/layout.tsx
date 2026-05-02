import type { Metadata } from "next";
import { Onest, JetBrains_Mono, Bricolage_Grotesque } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { SolanaProvider } from "@/components/providers/SolanaProvider";
import { VaultProvider } from "@/components/providers/VaultProvider";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

const onest = Onest({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Erebor",
  description: "Solana multi-strategy yield vault",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${onest.variable} ${mono.variable} ${display.variable}`}
    >
      <body className="min-h-screen bg-[var(--color-surface)] font-sans antialiased">
        <SolanaProvider>
          <VaultProvider>
            <Navbar />
            <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: "#1a1d2e",
                  color: "#e2e8f0",
                  border: "1px solid #2a2e45",
                },
              }}
            />
          </VaultProvider>
        </SolanaProvider>
      </body>
    </html>
  );
}

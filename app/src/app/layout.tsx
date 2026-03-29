import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import { SolanaProvider } from "@/components/providers/SolanaProvider";
import { VaultProvider } from "@/components/providers/VaultProvider";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-surface)] antialiased">
        <SolanaProvider>
          <VaultProvider>
            <Navbar />
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
            <Toaster
              position="bottom-right"
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

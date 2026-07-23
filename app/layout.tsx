import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://v-pulse-ledger-dashboard.workers.dev"),
  title: "V-Pulse | Enterprise Transaction Ledger",
  description: "Secure real-time fintech transaction ledger dashboard with virtualized historical records.",
  applicationName: "V-Pulse",
  keywords: ["fintech ledger", "transaction monitoring", "virtualized dashboard", "secure proxy"],
  openGraph: {
    title: "V-Pulse",
    description: "Enterprise-grade virtualized transaction ledger with server-side brokerage.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

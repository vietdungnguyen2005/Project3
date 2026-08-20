import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://v-pulse-payment-ops.workers.dev"),
  title: "V-Pulse | Payment Reliability Control Plane",
  description: "Operational control plane for containing payment rail failures and safely recovering parked work.",
  applicationName: "V-Pulse",
  keywords: ["payment reliability", "Spring Boot", "circuit breaker", "incident recovery"],
  openGraph: {
    title: "V-Pulse",
    description: "Contain downstream payment failures and safely recover parked work.",
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

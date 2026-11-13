import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pavilion — The IPL auction, your way",
  description: "Build your dream squad. A human-led IPL mock auction with live team bidding, custom player pools, and a seat for everyone.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

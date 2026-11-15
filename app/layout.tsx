import type { Metadata } from "next";
import { AuctionScrollbar } from "@/components/auction-scrollbar";
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
      <body id="pavilion-page" className="antialiased">{children}<AuctionScrollbar /></body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdSpy Discover",
  description: "Feed d'inspiration publicitaire Meta",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

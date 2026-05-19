import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Coach",
  description: "Coaching running personnalisé",
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

import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Sockudo AI Transport core SDK demo",
  description: "Core TransportProvider quickstart over Sockudo AI Transport.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

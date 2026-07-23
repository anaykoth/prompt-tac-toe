import "./globals.css";

export const metadata = {
  title: "Prompt-Tac-Toe",
  description: "Ultimate tic-tac-toe fueled by Claude prompts",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

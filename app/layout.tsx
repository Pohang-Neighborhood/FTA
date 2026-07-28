import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const siteTitle = "FTA | Football Tactics Architect";
const siteDescription =
  "실제 선수 능력치로 이동 경로와 패스 상황을 재현하는 축구 전술 시뮬레이터";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const fallbackProtocol = host.startsWith("localhost") ? "http" : "https";
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : fallbackProtocol;
  let metadataBase: URL;
  try {
    metadataBase = new URL(`${protocol}://${host}`);
  } catch {
    metadataBase = new URL("http://localhost:3000");
  }
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: {
      default: siteTitle,
      template: "%s | FTA",
    },
    description: siteDescription,
    applicationName: "Football Tactics Architect",
    category: "sports",
    openGraph: {
      type: "website",
      title: siteTitle,
      description: siteDescription,
      siteName: "Football Tactics Architect",
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "FTA 선수 움직임과 패스 전술 시뮬레이터",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: siteTitle,
      description: siteDescription,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

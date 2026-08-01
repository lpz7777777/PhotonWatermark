import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Photon Frame · 光子水印",
  description: "在浏览器本地读取照片 EXIF，生成相机参数水印与原分辨率相框。",
  applicationName: "Photon Frame",
  keywords: ["照片水印", "EXIF", "相机参数", "相框", "无损导出"],
  openGraph: {
    title: "Photon Frame · 光子水印",
    description: "让参数成为照片的最后一笔。EXIF 自动读取，原分辨率本地导出。",
    images: [{ url: "/og.png", width: 1734, height: 907, alt: "Photon Frame 光子水印" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Photon Frame · 光子水印",
    description: "让参数成为照片的最后一笔。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

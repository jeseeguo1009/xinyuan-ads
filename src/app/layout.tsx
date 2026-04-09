import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '欣远广告 Agent',
  description: '跨境电商广告数据智能分析平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}

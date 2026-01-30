import type { Metadata } from 'next'
import './globals.css'
import Navigation from '@/components/Navigation'
import { ProgressProvider } from '@/contexts/ProgressContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AuthProvider } from '@/contexts/AuthContext'

export const metadata: Metadata = {
    title: 'C2 Vocab ✨ | 英語詞彙學習 | K-Pop Style Learning',
    description: '🌟 使用粵語學習 C2 級別英語詞彙的互動式閃卡應用程式 ✨ 時尚、高效、有趣！',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="zh-HK">
            <body>
                <ThemeProvider>
                    <AuthProvider>
                        <ProgressProvider>
                            <Navigation />
                            <main>{children}</main>
                        </ProgressProvider>
                    </AuthProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}

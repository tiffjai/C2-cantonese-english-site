import type { Metadata } from 'next'
import './globals.css'
import Navigation from '@/components/Navigation'
import { ProgressProvider } from '@/contexts/ProgressContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

export const metadata: Metadata = {
    title: 'C2 英語詞彙學習 | Cantonese-English Flashcards',
    description: '使用粵語學習 C2 級別英語詞彙的互動式閃卡應用程式',
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
                    <ProgressProvider>
                        <Navigation />
                        <main>{children}</main>
                    </ProgressProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}

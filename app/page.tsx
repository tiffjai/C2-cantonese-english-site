import Link from 'next/link'
import styles from './page.module.css'

export default function Home() {
    return (
        <div className={styles.container}>
            <section className={styles.hero}>
                <h1 className="animate-fade-in">
                    學習 C2 級別英語詞彙
                </h1>
                <p className={styles.subtitle}>
                    使用粵語介面，掌握最高級別英語詞彙
                </p>
                <p className={styles.description}>
                    涵蓋 A1 至 C2 所有 CEFR 級別，超過 9,900 個英語單詞
                </p>

                <div className={styles.features}>
                    <div className="card">
                        <h3>📚 閃卡模式</h3>
                        <p>翻轉卡片學習單詞</p>
                    </div>
                    <div className="card">
                        <h3>✅ 測驗模式</h3>
                        <p>多項選擇題測試</p>
                    </div>
                    <div className="card">
                        <h3>📊 進度追蹤</h3>
                        <p>記錄學習統計</p>
                    </div>
                </div>

                <div className={styles.cta}>
                    <Link href="/flashcards">
                        <button className="btn-primary">
                            開始學習 🚀
                        </button>
                    </Link>
                    <Link href="/quiz">
                        <button className="btn-secondary">
                            開始測驗
                        </button>
                    </Link>
                </div>
            </section>

            <section className={styles.levels}>
                <h2>選擇您的級別</h2>
                <div className={styles.levelGrid}>
                    {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => (
                        <Link key={level} href={`/flashcards?level=${level}`}>
                            <div className={`card ${styles.levelCard}`}>
                                <h3>{level}</h3>
                                <p className={styles.levelLabel}>
                                    {level.startsWith('A') && '初級'}
                                    {level.startsWith('B') && '中級'}
                                    {level.startsWith('C') && '高級'}
                                </p>
                            </div>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    )
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import styles from './page.module.css';

export default function LoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextPath = searchParams.get('next') || '/flashcards';
    const { user, login, loading } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!loading && user) {
            router.replace(nextPath);
        }
    }, [user, loading, router, nextPath]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        const result = await login({ email, password, name });
        setSubmitting(false);

        if (!result.ok) {
            setError(result.error);
            return;
        }

        router.replace(nextPath);
    };

    const fillDemo = () => {
        setName('Demo Learner');
        setEmail('demo@c2flashcards.com');
        setPassword('learnc2');
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <p className={styles.kicker}>登入或建立本機帳戶</p>
                <h1>歡迎回來 👋</h1>
                <p className={styles.subtitle}>
                    帳戶僅儲存在您的瀏覽器中。第一次登入會自動建立本機帳戶。
                </p>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <label className={styles.label}>
                        名稱 (顯示用)
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例如：學習者小張"
                            className={styles.input}
                        />
                    </label>

                    <label className={styles.label}>
                        電郵
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                            className={styles.input}
                        />
                    </label>

                    <label className={styles.label}>
                        密碼
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="至少 6 個字符"
                            required
                            className={styles.input}
                        />
                    </label>

                    {error && <div className={styles.error}>{error}</div>}

                    <button type="submit" className="btn-primary" disabled={submitting}>
                        {submitting ? '登入中…' : '登入 / 建立帳戶'}
                    </button>

                    <button type="button" className={styles.demoButton} onClick={fillDemo}>
                        使用示範帳戶填入資料
                    </button>
                </form>

                <div className={styles.meta}>
                    <div>
                        <p>登入後將自動跳轉至：<strong>{nextPath}</strong></p>
                        <p className={styles.note}>本地密碼僅存在您的裝置，請勿使用真實密碼。</p>
                    </div>
                    <button
                        type="button"
                        className={styles.skip}
                        onClick={() => router.push('/')}
                    >
                        ← 返回主頁
                    </button>
                </div>
            </div>
        </div>
    );
}

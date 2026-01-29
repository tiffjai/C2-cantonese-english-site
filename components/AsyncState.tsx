'use client';

import styles from './AsyncState.module.css';

type ErrorProps = {
    title?: string;
    message: string;
    onRetry?: () => void;
    onUseOffline?: () => void;
    showOffline?: boolean;
};

export function FlashcardSkeleton({ ctaLabel = '開始' }: { ctaLabel?: string }) {
    return (
        <div className={styles.shell} aria-busy="true">
            <div className={styles.row}>
                {[1, 2, 3, 4, 5, 6].map(item => (
                    <div key={item} className={`${styles.block}`} style={{ height: item % 2 === 0 ? 18 : 12 }} />
                ))}
            </div>
            <div className={styles.card}>
                <div className={styles.block} style={{ width: '50%', height: 20, marginBottom: 12 }} />
                <div className={styles.block} style={{ width: '70%', height: 14, marginBottom: 8 }} />
                <div className={styles.block} style={{ width: '60%', height: 14 }} />
                <div style={{ display: 'grid', gap: 10, marginTop: 24 }}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className={styles.block} style={{ height: 14, opacity: 0.8 }} />
                    ))}
                </div>
            </div>
            <div className={styles.ctaRow}>
                <button className={`${styles.buttonGhost}`} disabled aria-label={`${ctaLabel}（載入中）`}>
                    {ctaLabel}
                </button>
                <button className={`${styles.buttonGhost}`} disabled aria-label="下一張（載入中）">
                    下一張
                </button>
            </div>
        </div>
    );
}

export function QuizSkeleton({ ctaLabel = '開始測驗' }: { ctaLabel?: string }) {
    return (
        <div className={styles.shell} aria-busy="true">
            <div className={styles.block} style={{ width: '30%', height: 22 }} />
            <div className={styles.card}>
                <div className={styles.block} style={{ width: '40%', height: 18, marginBottom: 12 }} />
                <div className={styles.block} style={{ width: '65%', height: 14, marginBottom: 8 }} />
                <div className={styles.block} style={{ width: '55%', height: 14 }} />
                <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className={styles.block} style={{ height: 48, borderRadius: 12 }} />
                    ))}
                </div>
            </div>
            <div className={styles.ctaRow}>
                <button className={styles.buttonGhost} disabled aria-label={`${ctaLabel}（載入中）`}>
                    {ctaLabel}
                </button>
                <button className={styles.buttonGhost} disabled aria-label="下一題（載入中）">
                    下一題
                </button>
            </div>
        </div>
    );
}

export function ProgressSkeleton() {
    return (
        <div className={styles.shell} aria-busy="true">
            <div className={styles.row}>
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className={styles.block} style={{ height: 120, borderRadius: 18 }} />
                ))}
            </div>
            <div className={styles.card}>
                <div className={styles.block} style={{ width: '35%', height: 20, marginBottom: 16 }} />
                {[1, 2, 3].map(i => (
                    <div key={i} className={styles.block} style={{ height: 56, borderRadius: 12, marginBottom: 10 }} />
                ))}
            </div>
        </div>
    );
}

export function ErrorState({ title = '載入失敗', message, onRetry, onUseOffline, showOffline }: ErrorProps) {
    return (
        <div role="alert" className={styles.error}>
            <h3>{title}</h3>
            <p>{message}</p>
            <div className={styles.errorActions}>
                {onRetry && (
                    <button className="btn-primary" onClick={onRetry}>
                        重試
                    </button>
                )}
                {showOffline && onUseOffline && (
                    <button className="btn-secondary" onClick={onUseOffline}>
                        使用離線快取
                    </button>
                )}
            </div>
        </div>
    );
}

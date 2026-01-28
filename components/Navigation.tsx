'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/contexts/ThemeContext';
import styles from './Navigation.module.css';

export default function Navigation() {
    const pathname = usePathname();
    const { theme, toggleTheme } = useTheme();

    const navItems = [
        { href: '/', label: '主頁', icon: '🏠' },
        { href: '/flashcards', label: '閃卡', icon: '📚' },
        { href: '/quiz', label: '測驗', icon: '✅' },
        { href: '/progress', label: '進度', icon: '📊' },
    ];

    return (
        <nav className={styles.nav}>
            <div className={styles.container}>
                <Link href="/" className={styles.logo}>
                    <span className={styles.logoIcon}>🎓</span>
                    <span className={styles.logoText}>C2 英語學習</span>
                </Link>

                <ul className={styles.navList}>
                    {navItems.map((item) => (
                        <li key={item.href}>
                            <Link
                                href={item.href}
                                className={`${styles.navLink} ${pathname === item.href ? styles.active : ''
                                    }`}
                            >
                                <span className={styles.navIcon}>{item.icon}</span>
                                <span className={styles.navLabel}>{item.label}</span>
                            </Link>
                        </li>
                    ))}
                </ul>

                <button
                    onClick={toggleTheme}
                    className={styles.themeToggle}
                    aria-label="Toggle theme"
                >
                    {theme === 'dark' ? '☀️' : '🌙'}
                </button>
            </div>
        </nav>
    );
}

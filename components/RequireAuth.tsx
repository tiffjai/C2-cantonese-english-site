'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const currentPath = searchParams?.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;

    useEffect(() => {
        if (!loading && !user) {
            router.replace(`/login?next=${encodeURIComponent(currentPath)}`);
        }
    }, [loading, user, router, currentPath]);

    if (loading || !user) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '50vh',
                color: 'var(--text-secondary)',
            }}>
                正在驗證登入狀態…
            </div>
        );
    }

    return <>{children}</>;
}

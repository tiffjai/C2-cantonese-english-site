'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type AuthUser = {
    id: string;
    email: string;
    name: string;
};

type LoginPayload = {
    email: string;
    password: string;
    name?: string;
};

type LoginResult =
    | { ok: true; created?: boolean }
    | { ok: false; error: string };

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    login: (payload: LoginPayload) => Promise<LoginResult>;
    logout: () => void;
}

type StoredUser = AuthUser & { password: string };

const SESSION_KEY = 'c2-auth-session-v1';
const USERS_KEY = 'c2-auth-users-v1';

const makeId = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const readUsers = (): Record<string, StoredUser> => {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(USERS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.warn('Failed to read saved users', error);
        return {};
    }
};

const writeUsers = (users: Record<string, StoredUser>) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch (error) {
        console.warn('Failed to persist users', error);
    }
};

const saveSession = (user: AuthUser) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } catch (error) {
        console.warn('Failed to persist session', error);
    }
};

const loadSession = (): AuthUser | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Failed to read session', error);
        return null;
    }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const existing = loadSession();
        if (existing) {
            setUser(existing);
        }
        setLoading(false);
    }, []);

    const login = async (payload: LoginPayload): Promise<LoginResult> => {
        const email = payload.email.trim().toLowerCase();
        const password = payload.password.trim();
        const displayName = payload.name?.trim() || email.split('@')[0];

        if (!email || !password) {
            return { ok: false, error: '請輸入電郵和密碼' };
        }

        setLoading(true);
        try {
            const users = readUsers();
            const existing = users[email];

            if (existing) {
                if (existing.password !== password) {
                    return { ok: false, error: '密碼不正確，請再試一次' };
                }
                const publicUser = { id: existing.id, email: existing.email, name: existing.name };
                setUser(publicUser);
                saveSession(publicUser);
                return { ok: true };
            }

            const newUser: StoredUser = {
                id: makeId(),
                email,
                name: displayName,
                password,
            };

            writeUsers({ ...users, [email]: newUser });
            const publicUser = { id: newUser.id, email: newUser.email, name: newUser.name };
            setUser(publicUser);
            saveSession(publicUser);
            return { ok: true, created: true };
        } finally {
            setLoading(false);
        }
    };

    const logout = () => {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(SESSION_KEY);
        }
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

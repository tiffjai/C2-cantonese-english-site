'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiOutput } from '@/workers/ai-v2.worker';
import styles from './AiChatbot.module.css';

type Status = 'idle' | 'downloading' | 'generating' | 'success' | 'error';

type PosBucket = 'noun' | 'verb' | 'adj' | 'adv' | 'unknown';

interface Message {
    id: string;
    type: 'user' | 'bot';
    content: string;
    timestamp: Date;
}

interface AiChatbotProps {
    word: string;
    level: string;
    meaning?: string;
    pos?: PosBucket;
    distractors?: string[];
}

export default function AiChatbot({ word, level, meaning, pos, distractors }: AiChatbotProps) {
    const workerRef = useRef<Worker | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [debugText, setDebugText] = useState<string | null>(null);
    const [result, setResult] = useState<AiOutput | null>(null);
    const [modelReady, setModelReady] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const worker = new Worker(new URL('../workers/ai-v2.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (event: MessageEvent<any>) => {
            const msg = event.data;
            if (!msg || !msg.type) return;

            if (msg.type === 'status') {
                if (msg.status === 'loading-model') {
                    setStatus('downloading');
                    setDownloadProgress(null);
                } else if (msg.status === 'model-ready') {
                    setModelReady(true);
                } else if (msg.status === 'generating') {
                    setStatus('generating');
                }
                return;
            }

            if (msg.type === 'progress') {
                setDownloadProgress({ loaded: msg.loaded, total: msg.total });
                setStatus('downloading');
                return;
            }

            if (msg.type === 'result') {
                setResult(msg.payload);
                setStatus('success');
                setError(null);
                setDebugText(msg.rawText || null);
                
                // Add bot response to chat
                const botResponse = generateBotResponse(msg.payload, word);
                addMessage('bot', botResponse);
                setIsTyping(false);
                return;
            }

            if (msg.type === 'error') {
                setError(msg.message || 'Something went wrong. Please try again.');
                const raw = typeof msg.rawText === 'string' ? msg.rawText.trim() : '';
                setDebugText(raw || '(no raw output received)');
                setStatus('error');
                setIsTyping(false);
                
                // Add error message to chat
                addMessage('bot', `I'm having trouble generating examples for "${word}" right now. This might be due to the complexity of the word or a temporary issue. Please try again or choose a different word!`);
                return;
            }
        };

        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    // Reset UI when switching words
    useEffect(() => {
        setStatus('idle');
        setError(null);
        setResult(null);
        setDebugText(null);
        setDownloadProgress(null);
        setMessages([]);
    }, [word]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const addMessage = (type: 'user' | 'bot', content: string) => {
        const newMessage: Message = {
            id: Date.now().toString(),
            type,
            content,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, newMessage]);
    };

    const generateBotResponse = (aiOutput: AiOutput, word: string): string => {
        const easySentence = aiOutput.examples.find(e => e.difficulty === 'easy')?.sentence || '';
        const normalSentence = aiOutput.examples.find(e => e.difficulty === 'normal')?.sentence || '';
        const advancedSentence = aiOutput.examples.find(e => e.difficulty === 'advanced')?.sentence || '';
        
        return `Here are three sentences using "${word}" at different difficulty levels:

**Easy:** ${easySentence}
**Normal:** ${normalSentence}
**Advanced:** ${advancedSentence}

Now, here's a cloze quiz to test your understanding:

**Fill in the blank:** ${aiOutput.cloze.sentence}

**Options:**
A) ${aiOutput.cloze.options[0]}
B) ${aiOutput.cloze.options[1]}
C) ${aiOutput.cloze.options[2]}
D) ${aiOutput.cloze.options[3]}

**Answer:** ${aiOutput.cloze.answer} - ${aiOutput.cloze.options[aiOutput.cloze.answer.charCodeAt(0) - 65]}

**Explanation:** ${aiOutput.cloze.explanation}`;
    };

    const handleGenerate = () => {
        if (!workerRef.current || !word) return;
        
        // Add user message
        addMessage('user', `Please generate examples and a quiz for the word "${word}".`);
        
        setError(null);
        setResult(null);
        setStatus(modelReady ? 'generating' : 'downloading');
        setDownloadProgress(null);
        setIsTyping(true);

        workerRef.current.postMessage({
            type: 'generate',
            word,
            level,
            pos,
            meaning,
            distractors,
        });
    };

    const isBusy = status === 'downloading' || status === 'generating';

    const statusLine = useMemo(() => {
        if (status === 'downloading') return 'Downloading the small on-device model (cached for future runs)…';
        if (status === 'generating') return 'Generating examples and a cloze quiz in your browser…';
        if (status === 'success') return 'Generated locally. You can regenerate for a new variant.';
        if (status === 'error') return 'Generation failed. Please retry.';
        if (modelReady) return 'Model cached. Ready to generate instantly.';
        return 'Runs fully in-browser. First run may take a few seconds to load.';
    }, [status, modelReady]);

    return (
        <div className={styles.chatbot}>
            <div className={styles.header}>
                <div className={styles.titleGroup}>
                    <span className={styles.eyebrow}>AI Language Tutor</span>
                    <div className={styles.title}>🤖 Mini Chatbot</div>
                    <p className={styles.subtitle}>
                        Chat with our AI to learn vocabulary. Ask for examples, quizzes, and explanations for "{word}".
                    </p>
                </div>
            </div>

            <div className={styles.chatContainer}>
                <div className={styles.messages}>
                    {messages.map((message) => (
                        <div key={message.id} className={`${styles.message} ${styles[message.type]}`}>
                            <div className={styles.avatar}>
                                {message.type === 'user' ? '👤' : '🤖'}
                            </div>
                            <div className={styles.messageContent}>
                                <div className={styles.messageText}>{message.content}</div>
                                <div className={styles.timestamp}>
                                    {message.timestamp.toLocaleTimeString()}
                                </div>
                            </div>
                        </div>
                    ))}
                    {isTyping && (
                        <div className={`${styles.message} ${styles.bot}`}>
                            <div className={styles.avatar}>🤖</div>
                            <div className={styles.messageContent}>
                                <div className={styles.typing}>
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className={styles.inputArea}>
                    <div className={styles.status}>
                        <span className={styles.pulse} />
                        <span>{statusLine}</span>
                        {modelReady && <span className={styles.badge}>Model cached</span>}
                    </div>

                    {error && (
                        <div className={styles.error}>
                            <p>{error}</p>
                            <button className="btn-secondary" onClick={handleGenerate} disabled={isBusy}>
                                Retry
                            </button>
                        </div>
                    )}

                    {debugText !== null && (
                        <div className={styles.debug}>
                            <div className={styles.debugTitle}>Model output</div>
                            <pre>{debugText}</pre>
                        </div>
                    )}

                    {status === 'downloading' && downloadProgress?.total ? (
                        <div className={styles.progressBar} aria-label="Model download progress">
                            <div
                                className={styles.progressFill}
                                style={{ width: `${Math.min(100, (downloadProgress.loaded / downloadProgress.total) * 100)}%` }}
                            />
                        </div>
                    ) : null}

                    <div className={styles.controls}>
                        <button
                            className="btn-primary"
                            onClick={handleGenerate}
                            disabled={isBusy || !word}
                        >
                            🚀 Generate Examples for "{word}"
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
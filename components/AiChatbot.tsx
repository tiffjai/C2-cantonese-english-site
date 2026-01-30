'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import styles from './AiChatbot.module.css';

type Status = 'idle' | 'generating' | 'success' | 'error';

type PosBucket = 'noun' | 'verb' | 'adj' | 'adv' | 'unknown';

interface Message {
    id: string;
    type: 'user' | 'bot';
    content: string;
    timestamp: Date;
}

interface AiOutput {
    examples: Array<{ difficulty: string; sentence: string }>;
    cloze: {
        sentence: string;
        options: string[];
        answer: string;
        explanation: string;
    };
}

interface AiChatbotProps {
    word: string;
    level: string;
    meaning?: string;
    pos?: PosBucket;
    distractors?: string[];
}

export default function AiChatbot({ word, level, meaning, pos, distractors }: AiChatbotProps) {
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<AiOutput | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Reset UI when switching words
    useEffect(() => {
        setStatus('idle');
        setError(null);
        setResult(null);
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

    const handleGenerate = async () => {
        if (!word) return;
        
        // Add user message
        addMessage('user', `Please generate examples and a quiz for the word "${word}".`);
        
        setError(null);
        setResult(null);
        setStatus('generating');
        setIsTyping(true);

        try {
            const response = await fetch('/api/ai-generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    word,
                    level,
                    pos,
                    meaning,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to generate content');
            }

            setResult(data.data);
            setStatus('success');
            
            // Add bot response to chat
            const botResponse = generateBotResponse(data.data, word);
            addMessage('bot', botResponse);
        } catch (err: any) {
            console.error('[AiChatbot] Error:', err);
            setError(err.message || 'Something went wrong. Please try again.');
            setStatus('error');
            addMessage('bot', `I'm having trouble generating examples for "${word}" right now. Please try again!`);
        } finally {
            setIsTyping(false);
        }
    };

    const isBusy = status === 'generating';

    const statusLine = useMemo(() => {
        if (status === 'generating') return 'Generating examples using Groq AI...';
        if (status === 'success') return 'Generated successfully! Click to regenerate.';
        if (status === 'error') return 'Generation failed. Please retry.';
        return 'Click below to generate AI-powered examples and quiz.';
    }, [status]);

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
                        <span className={styles.badge}>Groq AI</span>
                    </div>

                    {error && (
                        <div className={styles.error}>
                            <p>{error}</p>
                            <button className="btn-secondary" onClick={handleGenerate} disabled={isBusy}>
                                Retry
                            </button>
                        </div>
                    )}

                    <div className={styles.controls}>
                        <button
                            className="btn-primary"
                            onClick={handleGenerate}
                            disabled={isBusy || !word}
                        >
                            {isBusy ? '⏳ Generating...' : `🚀 Generate Examples for "${word}"`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

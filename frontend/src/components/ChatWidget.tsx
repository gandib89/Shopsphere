import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { MessageCircle, X, Send, Loader2, Bot, User } from 'lucide-react';

interface Message {
  role: 'user' | 'bot';
  content: string;
}

const GREETING = "Hi, I'm ShopBot, your ShopSphere assistant. Ask me about products, pricing, stock, or orders.";

const ChatWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', content: GREETING },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(false);
  const keyboardOffset = 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // No keyboard offset needed for browser — inputs are never hidden by a system keyboard
  // (keyboardOffset stays 0 always on desktop/web)

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Focus input when opened and scroll messages to bottom
  useEffect(() => {
    if (open) {
      setUnread(false);
      setTimeout(() => {
        inputRef.current?.focus();
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    setInput('');
    setLoading(true);

    try {
      const { data } = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/chat`,
        { message: text, history: updatedHistory },
      );
      const botMsg: Message = { role: 'bot', content: data.reply };
      setMessages(prev => [...prev, botMsg]);
      if (!open) setUnread(true);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'bot', content: "Sorry, I'm having trouble connecting right now. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Chat Window */}
      {open && (
        <div role="dialog" aria-modal="false" aria-label="ShopSphere assistant" className="fixed right-3 z-50 flex w-[calc(100vw-1.5rem)] origin-bottom-right flex-col overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-float animate-panel-in sm:right-6 sm:w-[380px]" style={{ bottom: `${88 + keyboardOffset}px`, maxHeight: `calc(75vh - ${keyboardOffset}px)`, transition: 'bottom 0.18s var(--ease-out)' }}>
          {/* Header */}
          <div className="bg-ink text-paper px-4 py-3 flex items-center justify-between flex-shrink-0 border-b border-brass/40">
            <div className="flex items-center gap-2">
              <div className="border border-brass/60 rounded-full p-1.5">
                <Bot className="w-4 h-4 text-brass" />
              </div>
              <div>
                <p className="font-bold text-sm leading-tight">ShopBot</p>
                <p className="text-paper/55 text-xs">ShopSphere Assistant</p>
              </div>
              <span className="ml-1 w-2 h-2 bg-brass rounded-full" title="Online" />
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
              aria-label="Close ShopSphere assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-paper min-h-0">
            {messages.map((msg, i) => (
              <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border ${
                  msg.role === 'bot' ? 'border-brass/50' : 'border-hairline'
                }`}>
                  {msg.role === 'bot'
                    ? <Bot className="w-4 h-4 text-brass" />
                    : <User className="w-4 h-4 text-ink-muted" />}
                </div>
                {/* Bubble */}
                <div className={`max-w-[75%] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-ink text-paper'
                    : 'bg-paper-raised text-ink border border-hairline'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-end gap-2">
                <div className="w-7 h-7 rounded-full border border-brass/50 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-brass" />
                </div>
                <div className="bg-paper-raised border border-hairline px-4 py-2">
                  <Loader2 className="w-4 h-4 text-brass animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 px-3 py-3 bg-paper-raised border-t border-hairline">
            <div className="flex items-center gap-2 bg-paper border border-hairline px-3 py-2 focus-within:border-brass transition">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask about products, stock, orders…"
                className="flex-1 bg-transparent text-sm text-ink placeholder-ink-muted/60 focus:outline-none"
                disabled={loading}
                aria-label="Message ShopSphere assistant"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed text-white bg-brass hover:bg-brass-dark p-1.5 transition"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-center text-xs text-ink-muted mt-1.5">Powered by ShopSphere AI</p>
          </div>
        </div>
      )}

      {/* FAB Button */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        className="fixed right-3 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-brass/30 bg-ink text-white shadow-float transition-colors hover:bg-graphite sm:right-6"
        style={{ bottom: `calc(${16 + keyboardOffset}px + env(safe-area-inset-bottom))`, transition: 'bottom 0.18s var(--ease-out)' }}
        aria-label={open ? 'Close ShopSphere assistant' : 'Open ShopSphere assistant'}
        aria-expanded={open}
      >
        {open
          ? <X className="w-5 h-5" />
          : <MessageCircle className="w-5 h-5" />}
        {!open && unread && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-seal rounded-full border-2 border-paper" />
        )}
      </button>
    </>
  );
};

export default ChatWidget;

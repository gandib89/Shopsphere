import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { Bot, Loader2, MessageCircle, Send, User, X } from 'lucide-react';

interface Message { role: 'user' | 'bot'; content: string }
const GREETING = "Hi, I'm ShopBot. Ask me about products, pricing, and stock.";
const hiddenRoutes = /^\/(cart-checkout|checkout|success|failure|admin|seller|add-product|all-products|product-details-admin)/;

export default function ChatWidget() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'bot', content: GREETING }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardOffset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => {
    if (!open) return;
    setUnread(false);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', close); };
  }, [open]);
  useEffect(() => { if (hiddenRoutes.test(pathname)) setOpen(false); }, [pathname]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history); setInput(''); setLoading(true);
    try {
      const { data } = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/api/v1/chat`, { message: text, history });
      setMessages(previous => [...previous, { role: 'bot', content: data.reply }]);
      if (!open) setUnread(true);
    } catch {
      setMessages(previous => [...previous, { role: 'bot', content: "Sorry, I couldn't connect. Please try again." }]);
    } finally { setLoading(false); }
  };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); void sendMessage(); } };

  if (hiddenRoutes.test(pathname)) return null;
  return <>
    {open && <div role="dialog" aria-modal="false" aria-label="ShopSphere assistant" className="fixed right-3 z-50 flex w-[calc(100vw-1.5rem)] origin-bottom-right flex-col overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-float animate-panel-in sm:right-6 sm:w-[380px]" style={{ bottom: `${88 + keyboardOffset}px`, maxHeight: `max(16rem, calc(100dvh - ${128 + keyboardOffset}px))` }}>
      <header className="flex shrink-0 items-center justify-between border-b border-brass/40 bg-ink px-4 py-3 text-paper"><div className="flex items-center gap-2"><span className="rounded-full border border-brass/60 p-1.5"><Bot className="h-4 w-4 text-brass" aria-hidden="true" /></span><div><h2 className="text-sm font-bold">ShopBot</h2><p className="text-xs text-paper/60">Product assistant</p></div></div><button onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] hover:bg-paper/10" aria-label="Close ShopSphere assistant"><X className="h-5 w-5" aria-hidden="true" /></button></header>
      <div role="log" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-paper p-4">{messages.map((message, index) => <div key={index} className={`flex items-end gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline" aria-hidden="true">{message.role === 'bot' ? <Bot className="h-4 w-4 text-brass" /> : <User className="h-4 w-4 text-ink-muted" />}</span><p className={`max-w-[78%] px-3 py-2 text-sm leading-relaxed ${message.role === 'user' ? 'bg-ink text-paper' : 'border border-hairline bg-paper-raised text-ink'}`}>{message.content}</p></div>)}{loading && <div className="flex items-center gap-2 text-sm text-ink-muted" role="status"><Loader2 className="h-4 w-4 animate-spin text-brass" aria-hidden="true" />ShopBot is responding…</div>}<div ref={bottomRef} /></div>
      <div className="shrink-0 border-t border-hairline bg-paper-raised p-3"><div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-hairline bg-paper px-3 py-2 focus-within:border-brass"><input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={onInputKeyDown} placeholder="Ask about products or stock…" disabled={loading} aria-label="Message ShopSphere assistant" className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none" /><button onClick={() => void sendMessage()} disabled={!input.trim() || loading} className="flex h-9 w-9 shrink-0 items-center justify-center bg-brass text-white disabled:opacity-40" aria-label="Send message"><Send className="h-4 w-4" aria-hidden="true" /></button></div><p className="mt-1.5 text-center text-xs text-ink-muted">Product information may change. Confirm details on the listing.</p></div>
    </div>}
    <button ref={triggerRef} onClick={() => setOpen(value => !value)} className="fixed right-3 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-brass/30 bg-ink text-white shadow-float hover:bg-graphite sm:right-6" style={{ bottom: `calc(${16 + keyboardOffset}px + env(safe-area-inset-bottom))` }} aria-label={open ? 'Close ShopSphere assistant' : unread ? 'Open ShopSphere assistant, new reply available' : 'Open ShopSphere assistant'} aria-expanded={open}>{open ? <X className="h-5 w-5" aria-hidden="true" /> : <MessageCircle className="h-5 w-5" aria-hidden="true" />}{!open && unread && <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-paper bg-seal" aria-hidden="true" />}</button>
  </>;
}

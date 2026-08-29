import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import Groq from "groq-sdk";
import { prisma } from "../database/prismaClient.js";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chatRouter = express.Router();
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
});
const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(z.object({
    role: z.enum(["user", "bot"]),
    content: z.string().max(1000),
  })).max(10).optional(),
});

// Load FAQs from knowledge base
const faqsPath = path.join(__dirname, "../chatbot/faqs.json");
const faqs = existsSync(faqsPath) ? JSON.parse(readFileSync(faqsPath, "utf-8")) : [];

// Load Apriori recommendations map
const recsPath = path.join(__dirname, "../recommendation/output/recommendations_map.json");
let recommendationsMap = {};
try {
  if (existsSync(recsPath)) {
    recommendationsMap = JSON.parse(readFileSync(recsPath, "utf-8"));
  }
} catch (_e) { /* silent — chatbot still works without it */ }

chatRouter.post("/", chatLimiter, async (req, res) => {
  try {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ reply: "Please send a shorter valid message." });
    const { message, history = [] } = parsed.data;

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === "your_groq_api_key_here") {
      return res.status(500).json({ reply: "Chatbot is not configured yet — API key missing. Please contact support." });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 10_000, maxRetries: 1 });

    // Fetch live products from DB
    const products = await prisma.product.findMany({
      take: 60,
      select: { name: true, price: true, category: true, quantity: true, colorVariants: true, storageVariants: true },
    });
    const productContext = products
      .map(p => {
        const stockLabel = p.quantity === 0 ? "[Out of Stock]" : `[In Stock: ${p.quantity} units]`;
        let line = `- ${p.name} (${p.category}) — Rs. ${p.price.toLocaleString()} ${stockLabel}`;
        // Color variant stock
        if (p.colorVariants?.length) {
          const colorStock = p.colorVariants.map(c => `${c.color}: ${c.stock > 0 ? c.stock + " units" : "OUT OF STOCK"}`).join(", ");
          line += ` | Colors: ${colorStock}`;
        }
        // Storage variant stock
        if (p.storageVariants?.length) {
          const storageStock = p.storageVariants.map(s => `${s.storage}: ${s.stock > 0 ? s.stock + " units" : "OUT OF STOCK"}`).join(", ");
          line += ` | Storage: ${storageStock}`;
        }
        return line;
      })
      .join("\n");

    // Build FAQ context
    const faqContext = faqs.map(f => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");

    // Build recommendations context (sample top 20)
    const recsSample = Object.entries(recommendationsMap)
      .slice(0, 20)
      .map(([product, recs]) => `${product} → often bought with: ${recs.slice(0, 3).join(", ")}`)
      .join("\n");

    const systemPrompt = `You are ShopSphere's friendly store assistant. ShopSphere is Nepal's premium online Apple tech marketplace.

STRICT RULES:
- ONLY answer questions about ShopSphere products, orders, pricing, policies, delivery, and product recommendations.
- If asked anything entirely unrelated (homework, coding help, news, general knowledge), politely reply: "I'm only able to help with ShopSphere-related questions. 😊"
- Keep all responses short, clear, and friendly (2–4 sentences max).
- When recommending products, always mention the price in Rs.
- Never invent prices, policies, or information not listed below.
- Use emojis sparingly to keep things friendly.
- CRITICAL: The prices listed in the store are the OFFICIAL ShopSphere prices. Never question, correct, compare, or comment on any product's price. Never say a price seems low, is a mistake, or suggest what the "actual" or "real-world" price should be. Always state the listed price as-is without any commentary.
- CRITICAL: When asked about stock or availability, always state the exact quantity number from the product data (e.g. "12 units in stock").
- CRITICAL: Never mention or suggest a color, storage, or variant that is marked OUT OF STOCK. Only suggest variants that have stock > 0.

=== STORE POLICIES & FAQs ===
${faqContext}

=== AVAILABLE PRODUCTS (Live from store) ===
${productContext}

=== FREQUENTLY BOUGHT TOGETHER ===
${recsSample}`;

    // Convert history to Groq format — skip initial greeting, cap at last 10
    const chatHistory = history
      .filter((_, i) => i > 0)
      .slice(-10)
      .map(h => ({
        role: h.role === "bot" ? "assistant" : "user",
        content: h.content,
      }));

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: message },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    res.json({ reply });
  } catch (error) {
    console.error("Groq chat error:", error?.status, error?.message?.slice(0, 100));
    if (error?.status === 429) {
      return res.status(200).json({
        reply: "I'm a little busy right now! Please try again in a moment. 🙏",
      });
    }
    res.status(500).json({
      reply: "Sorry, I'm having trouble responding right now. Please try again in a moment! 😊",
    });
  }
});

export default chatRouter;

# ShopSphere — Full Architecture

## About this document

This document explains the entire architecture of **ShopSphere**, the e-commerce
project living in this repository, from an absolute-beginner starting point.

Three rules govern everything written here:

1. **The repository is the source of truth.** Every file path, every code snippet,
   and every behaviour described below was read out of the actual code in this repo
   before being written down. Nothing is invented.
2. **Every technical term is explained before it is used.** If you have never heard
   of a "middleware", a "webhook", an "HMAC signature", or an "ORM", you will find
   each one defined in plain English at the point where ShopSphere first needs it.
3. **Where the code and the intention differ, both are stated.** Some parts of this
   codebase contain leftovers, stale comments, or half-finished migrations. Those are
   pointed out explicitly rather than smoothed over, because understanding *why* a
   codebase drifted is part of understanding its architecture.

Throughout, three different things are kept visibly separate:

- **What the code actually does** — verifiable by reading the file named.
- **Why it was designed that way** — the architectural reasoning, drawn from code
  comments, commit messages, and the shape of the code itself.
- **What could theoretically be done differently** — alternatives, clearly labelled
  as alternatives and not as things the repo does.

### Version / commit context

At the time of writing, the repository is on branch `main`. The most recent commits are:

```
7a5e79f  Remove unused khalti-checkout-web dependency; add zod validation to remaining
         money-handling endpoints; add opt-in pagination; add GitHub Actions CI;
         add Dockerfiles for backend and frontend; add unit tests
39904f6  Fix ReferenceError in bulk-order revenue creation; wrap stock/order/revenue
         updates in DB transactions; validate order bodies with zod; persist Bill rows
         via idempotent upsert; add baseline security headers; cap unbounded list queries
b06701e  Added Readme
461e005  Added Readme
8f4affd  feat: add eSewa payment integration with idempotent ledger
50641bc  feat: overhaul authentication with refresh tokens and password hashing
a512adf  add product, cart, order, promo code, and revenue APIs
6921803  feat: set up Express backend with Prisma ORM and PostgreSQL
e5710b9  Initial commit
```

Read those nine commit subjects top to bottom and you have the project's history in
miniature: a bare Express + Prisma skeleton, then the CRUD APIs, then a security
overhaul of authentication, then payments, then a hardening pass (transactions,
validation, pagination, CI, Docker).

**A note on the working tree.** `git status` at the time of writing shows several
files deleted from the working directory but still present in git history:
`README.md`, `AUTHENTICATION_UPDATE.md`, `AUTH_QUICK_START.md`, and
`GOOGLE_SIGNIN_SETUP.md`. The old `README.md` is still recoverable with
`git show HEAD:README.md` and is quoted in a few places in this document where it
documents design intent. It is also partly stale — it claims, for example, that no
security-headers middleware exists, which commit `39904f6` later added. Where the
README and the code disagree, **the code wins**, and the disagreement is flagged.

The `docs/` directory at the repository root exists but is currently empty.

---

## 1. Overall Architecture Overview

### 1.1 What kind of application is this?

ShopSphere is a **multi-vendor e-commerce web application**. Let us unpack all three
words, because each one drives a real architectural decision.

**E-commerce** means the software's job is to let people buy physical goods. Concretely
that means it must handle a catalogue of products, a shopping cart, an order, a payment,
and delivery of that order — and it must never lose track of money or stock while doing so.

**Multi-vendor** (also called a *marketplace*) means the products are not all sold by the
platform owner. Independent **sellers** each list their own products. The platform takes a
cut of every sale. Compare this to a single-vendor shop, where one company sells its own
inventory. Multi-vendor forces two extra things into the architecture that a single-vendor
shop would not need:

- A **seller role** with its own product-management and order-management screens, and a
  **verification** step where an administrator approves a seller before they may list
  anything. In this repo that is `isVerified` on the `User` model and the
  `checkSellerVerification` middleware in `backend/middlewares/authMiddleware.js`.
- A **commission split** on every sale, so the platform and the seller each know what
  they earned. In this repo that is the `Revenue` model and the hardcoded 5% figure
  (`totalPrice * 0.05`) in `backend/controller/order.js` and
  `backend/controller/revenueController.js`.

**Web application** means it runs in a browser. Specifically, ShopSphere is built as two
separate programs that talk to each other over HTTP, rather than one program that renders
HTML pages on the server:

- A **frontend**: a React single-page application (SPA) that runs entirely inside the
  user's browser.
- A **backend**: an Express REST API that runs on a server, talks to the database, and
  never renders any user-facing HTML (with one tiny exception — a redirect page after
  payment, covered in §5.4).

> **Jargon: SPA (Single-Page Application).** A traditional website asks the server for a
> brand new HTML page every time you click a link. An SPA downloads one HTML shell plus a
> bundle of JavaScript once; after that, clicking a link is handled by JavaScript, which
> swaps out part of the screen and fetches only *data* (usually JSON) from the server.
> Result: navigation feels instant, but the initial download is bigger, and search-engine
> indexing and the "back" button need extra care.

> **Jargon: REST API.** An "Application Programming Interface" that a program (not a human)
> talks to. "REST" is a convention where each kind of thing gets a URL path
> (`/api/v1/product`), and the HTTP verb says what you want to do with it: `GET` to read,
> `POST` to create, `PUT` to update, `DELETE` to remove. The data going back and forth is
> **JSON** — a plain-text format for structured data that looks like
> `{"name": "iPhone 17", "price": 124999}`.

### 1.2 The main components

ShopSphere has **five things it runs** and **four external services it calls**.

Things it runs:

| Component | What it is | Where it lives |
|---|---|---|
| Frontend SPA | React 18 + TypeScript, bundled by Vite, served as static files | `frontend/` |
| Backend API | Node.js + Express 4 REST API | `backend/` |
| Database | PostgreSQL 16, accessed through the Prisma ORM | `backend/prisma/`, `docker-compose.yml` |
| Uploads store | A plain directory of image files on the backend's disk | `backend/uploads/` (gitignored), served at `/uploads` |
| Recommendation trainer | An offline Python script producing a static JSON file | `backend/recommendation/` |

External services it calls:

| Service | What for | Code that calls it |
|---|---|---|
| eSewa | Payment gateway (Nepal) | `backend/utils/esewa.js`, `backend/controller/payment.js` |
| Google Identity | "Sign in with Google" | `backend/controller/auth.js` (`googleSignIn`) |
| Gmail SMTP | Transactional email | `backend/utils/emailService.js` |
| Groq | LLM API powering the store chatbot | `backend/routes/chatRoute.js` |

> **Jargon: payment gateway.** A company that actually moves the money. Your application
> never touches the customer's card or wallet credentials; it hands the customer off to
> the gateway, the gateway collects payment, and then tells your application whether it
> worked. eSewa is a widely used digital wallet and payment gateway in Nepal — which is
> why ShopSphere prices everything in `Rs.` (Nepalese rupees) and why the chatbot FAQ in
> `backend/chatbot/faqs.json` talks about delivery "within Pokhara Valley".

> **Jargon: ORM (Object-Relational Mapper).** A library that lets you read and write
> database rows using ordinary objects and method calls in your programming language,
> instead of writing SQL strings by hand. ShopSphere uses **Prisma**. Instead of
> `SELECT * FROM products WHERE id = '...'` you write
> `prisma.product.findUnique({ where: { id } })`.

### 1.3 Component diagram

```text
                            ┌──────────────────────────────┐
                            │   USER'S BROWSER             │
                            │  ┌────────────────────────┐  │
                            │  │ React SPA (frontend/)  │  │
                            │  │  - pages/  components/ │  │
                            │  │  - lib/session.ts      │  │
                            │  │    access token in RAM │  │
                            │  └───────────┬────────────┘  │
                            └──────────────┼───────────────┘
                                           │
             HTTP: JSON over axios or fetch
             Authorization: Bearer <15-min JWT>
             Cookie: refresh_token (httpOnly, path=/api/v1/auth)
                                           │
                                           v
  ┌────────────────────────────────────────────────────────────────────────┐
  │  BACKEND — Node.js + Express  (backend/app.js, backend/server.js)       │
  │                                                                        │
  │   [1] cors()               allow-list of permitted browser origins      │
  │   [2] security headers     nosniff / frame-deny / referrer / HSTS       │
  │   [3] express.json()       parse JSON request bodies                    │
  │   [4] cookieParser()       parse the refresh_token cookie               │
  │   [5] routers  ───────────────────────────────────────────────┐        │
  │        /api/v1/auth  product  order  payment  cart  revenue    │        │
  │        users  chat  notifications  promo  email                │        │
  │   [6] /uploads static file server                              │        │
  │   [7] errorMiddleware  (last resort)                           │        │
  │                                                                v        │
  │   per-route middleware:  authenticate -> authorizeAdmin/Seller          │
  │                          -> checkSellerVerification                     │
  │                                    │                                    │
  │                                    v                                    │
  │   controllers/  (all business logic)                                    │
  │        auth  productController  order  payment  cartController          │
  │        promoCodeController  revenueController  notificationController   │
  │        userManagement                                                   │
  │                                    │                                    │
  │                                    v                                    │
  │   utils/  tokens  refreshTokenStore  password  idempotency              │
  │           esewa  pagination  generateId  emailService  seedAdmin        │
  └───────────┬───────────────────┬──────────────┬────────────┬────────────┘
              │                   │              │            │
              v                   v              v            v
      ┌───────────────┐   ┌──────────────┐  ┌─────────┐  ┌──────────┐
      │ Prisma Client │   │  eSewa       │  │ Google  │  │ Gmail    │
      │       │       │   │  gateway     │  │ Identity│  │ SMTP     │
      │       v       │   └──────┬───────┘  └─────────┘  └──────────┘
      │ ┌───────────┐ │          │
      │ │PostgreSQL │ │          │ browser redirect back to
      │ │  16       │ │          │ /api/v1/payment/esewa/success/:orderId
      │ └───────────┘ │          │ (treated as UNTRUSTED — re-verified
      └───────────────┘          │  by a server-to-server status check)
                                 └────────────────┐
                                                  v
                                       back into the backend

      ┌────────────────────────────────────────────────────────────┐
      │ OFFLINE (run by hand, not at runtime)                       │
      │  backend/recommendation/train_apriori.py                    │
      │      reads data/Final_Apple_Apriori_Dataset_v2.csv          │
      │      writes output/recommendations_map.json                 │
      │      ^ read + cached 5 min by productController.js          │
      │      ^ read at boot by routes/chatRoute.js                  │
      └────────────────────────────────────────────────────────────┘
                                                  │
                                                  v
                                        ┌──────────────────┐
                                        │  Groq LLM API    │
                                        │  llama-3.1-8b    │
                                        └──────────────────┘
```

The numbered items `[1]`–`[7]` on the backend are in the exact order they appear in
`backend/app.js`. **That order matters**, and §6.7 explains why in detail.

### 1.4 Key technologies and their role, in one line each

| Technology | Role in ShopSphere |
|---|---|
| **React 18** | Draws the user interface and re-draws it when data changes |
| **TypeScript** | Adds type checking to JavaScript so mistakes surface at build time |
| **Vite** | Development server and production bundler for the frontend |
| **React Router 6 (HashRouter)** | Decides which page component to show for which URL |
| **Tailwind CSS** | Styling, written as utility class names in the markup |
| **axios** | The HTTP client used by most pages; hosts the auth interceptors |
| **Node.js 20** | The JavaScript runtime the backend executes in |
| **Express 4** | Routes incoming HTTP requests to the right handler function |
| **Prisma 7** | Type-safe database access; also owns the schema and migrations |
| **PostgreSQL 16** | The single source of truth for all persistent data |
| **jsonwebtoken** | Creates and verifies the short-lived access tokens |
| **@node-rs/argon2 + bcryptjs** | Hashes passwords (Argon2id now, bcrypt for legacy accounts) |
| **zod** | Validates the shape of incoming request bodies |
| **eSewa (custom integration)** | Takes the customer's money |
| **nodemailer** | Sends order/status emails through Gmail |
| **groq-sdk** | Powers the in-store chat assistant |
| **Python + mlxtend** | Offline "frequently bought together" model training |
| **Docker Compose** | Runs Postgres + backend + frontend together locally |
| **GitHub Actions** | Runs the test suites automatically on every push |

---

## 2. Technology Stack

This section takes each significant technology, explains what it *is* starting from zero,
says why it makes sense for **this** project specifically, and points at the exact files
where you can see it in use.

### 2.1 JavaScript, and why there are two languages here

**What it is.** JavaScript is the only programming language that web browsers can run
natively. Historically it ran *only* in browsers. In 2009, Node.js packaged the browser's
JavaScript engine so it could also run on servers.

**Where ShopSphere uses it.** Both sides. The backend (`backend/`) is plain JavaScript
running on Node.js. The frontend (`frontend/src/`) is TypeScript, which compiles down to
JavaScript, running in the browser.

**Why this matters architecturally.** One language across the stack means a developer can
move between frontend and backend without switching mental models, and small helpers can
in principle be shared. ShopSphere does *not* actually share code between the two halves —
`frontend/` and `backend/` are separate npm packages with separate `package.json` and
separate `node_modules` — but the cognitive benefit is still there.

**ES Modules.** Both `backend/package.json` and the root `package.json` declare
`"type": "module"`. That single line switches Node.js from the older `require()` style of
importing files to the modern `import`/`export` style:

```js
// backend/app.js — modern ESM style, enabled by "type": "module"
import express from "express";
import authRouter from "./routes/authRoute.js";
```

Note the `.js` on the end of `./routes/authRoute.js`. In ESM the file extension is
mandatory; in the old CommonJS style it was optional. Miss it and Node throws
`ERR_MODULE_NOT_FOUND`.

ESM also unlocks **top-level `await`** — the ability to use `await` outside of an `async`
function — which `backend/server.js` relies on:

```js
// backend/server.js
try {
    await dbConnection();     // <-- top-level await; only legal in an ES module
} catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exit(1);
}
```

> **Jargon: `await` and `async`.** Some operations (reading a database, calling another
> server) take time. Rather than freezing the whole program while waiting, JavaScript
> returns a **Promise** — an object meaning "the answer will arrive later". `await` pauses
> *just this function* until the Promise resolves, letting the rest of the program carry on.
> A function containing `await` must itself be marked `async` (except at the top level of
> an ES module, as above).

### 2.2 TypeScript

**What it is.** TypeScript is JavaScript plus **static types**. A type is a written
promise about what kind of value a variable holds. In plain JavaScript, `product.prcie`
(typo) is silently `undefined` and blows up later at runtime, possibly in production. In
TypeScript, the compiler catches it before the code ever runs.

**Where ShopSphere uses it.** The whole frontend: every file in `frontend/src` ends in
`.ts` or `.tsx`. Configuration lives in `frontend/tsconfig.json`,
`frontend/tsconfig.app.json`, and `frontend/tsconfig.node.json`.

Example from `frontend/src/lib/session.ts`:

```ts
export type SessionUser = {
  id: string;
  email: string;
  role: string;
  admin: boolean;
  seller: boolean;
  sellerVerified: boolean;
};
```

That is a **type alias**. Anywhere the code says a value is a `SessionUser`, the compiler
will guarantee it has all six of those fields with those exact kinds of value.

**Why the frontend and not the backend?** This is a genuine asymmetry in the repo. The
frontend is TypeScript; the backend is untyped JavaScript. Practically, the backend gets
*some* of the same protection anyway, from two other directions:

- Prisma generates TypeScript type definitions for every model (see
  `backend/generated/prisma/index.d.ts`), so editors can autocomplete `prisma.order.*`
  even in a `.js` file.
- `zod` (§2.9) validates request bodies at runtime, which is arguably *more* important
  than compile-time types for data arriving from the outside world — a compile-time type
  cannot stop a malicious client from POSTing garbage.

**Alternative not taken.** The backend could have been written in TypeScript too. The cost
is a build step (`tsc`) between editing and running, plus type definitions for every
Express handler. For a project of this size the team evidently judged that not worth it.

### 2.3 React 18

**What it is.** React is a library for building user interfaces out of **components**. A
component is a function that returns a description of what should appear on screen. When
the data behind a component changes, React re-runs the function and efficiently updates
only the parts of the real page that actually differ.

**Where ShopSphere uses it.** Every file under `frontend/src/pages/` and
`frontend/src/components/`.

The smallest complete example in the repo is `frontend/src/components/catalog/Money.tsx`:

```tsx
import { cn } from '../../lib/utils';

const formatNpr = (amount: number) => `Rs. ${Math.round(amount).toLocaleString('en-US')}`;

export const Money = ({ amount, previousAmount, className }:
    { amount: number; previousAmount?: number; className?: string }) => (
  <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums', className)}>
    <span className="text-lg font-semibold tracking-tight text-ink">{formatNpr(amount)}</span>
    {previousAmount && previousAmount > amount ? (
      <span className="text-sm text-ink-muted line-through">{formatNpr(previousAmount)}</span>
    ) : null}
  </div>
);
```

Reading this line by line:

- `formatNpr` turns a number like `120000` into the string `"Rs. 120,000"`. `Math.round`
  drops paise/decimals; `toLocaleString('en-US')` inserts the thousands separators.
- `Money` is the component. The object in its parameter list is **destructuring**: React
  passes one object of "props" (properties), and this syntax pulls out the three fields the
  component cares about. The `?` in `previousAmount?: number` means that prop is optional.
- The HTML-looking markup is **JSX** — a syntax extension where you write markup inside
  JavaScript. Vite compiles it into ordinary function calls before the browser sees it.
- `{previousAmount && previousAmount > amount ? (...) : null}` is **conditional rendering**:
  only show the struck-through original price if there *is* one and it is higher than the
  current price. Returning `null` renders nothing.

**Why React for an e-commerce site.** A product page has a lot of interdependent state:
which colour is selected, which storage size, is that combination in stock, what is the
resulting price, is the "Add to cart" button enabled. Expressing that as "given this state,
here is what the screen looks like" is dramatically easier to get right than manually
patching the page on every click.

**Two React concepts you will see constantly in this repo:**

**Hooks.** Functions starting with `use` that let a component remember things across
re-renders. `useState` holds a value; `useEffect` runs a side effect (like fetching data)
after render. From `frontend/src/components/NotificationBell.tsx`:

```tsx
const [notifications, setNotifications] = useState<Notification[]>([]);
const [unreadCount, setUnreadCount] = useState(0);

useEffect(() => {
  fetchNotifications();
  const interval = setInterval(fetchNotifications, 30000);
  return () => clearInterval(interval);
}, []);
```

`useState` gives back a pair: the current value, and a function to change it. `useEffect`
here starts a timer that re-fetches notifications every 30 seconds; the returned function
is a **cleanup** that React calls when the component is removed from the screen, stopping
the timer so it does not leak. The `[]` at the end means "run this effect once on mount,
never again".

**Lazy loading.** `frontend/src/App.tsx` wraps every page in `React.lazy`:

```tsx
const Home = lazy(() => import('./pages/Home'));
const Cart = lazy(() => import('./pages/Cart'));
// ...40 more
```

`import()` with parentheses is a **dynamic import**: the browser fetches that page's
JavaScript only when the user actually navigates there. Vite splits the bundle accordingly.
Without this, a first-time visitor landing on the home page would download the admin
revenue dashboard, the PDF generator, and the seller product editor before seeing anything.
The `<Suspense fallback={...}>` wrapper in `App.tsx` is what shows a loading spinner during
that fetch.

### 2.4 Vite

**What it is.** A **build tool**. Browsers cannot run TypeScript, cannot run JSX, and until
recently could not efficiently load hundreds of small module files. A build tool converts
your source code into something the browser can run fast.

**Where ShopSphere uses it.** `frontend/vite.config.ts`, and the `dev`/`build`/`preview`
scripts in `frontend/package.json`.

The config is worth reading in full because three of its settings encode real architectural
decisions:

```ts
// frontend/vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Required for Capacitor: assets must use relative paths (file:// protocol on device)
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-core': ['react', 'react-dom', 'react-router-dom'],
          'pdf-libs': ['jspdf', 'html2canvas'],
          'google-auth': ['@react-oauth/google'],
        },
      },
    },
  },
  server: { port: 5173, host: '0.0.0.0' },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', css: true },
});
```

- **`base: './'`** makes every generated asset URL relative rather than absolute. The
  comment explains why: **Capacitor**, a tool that wraps a web app as a native mobile app,
  loads files from the device filesystem over `file://`, where an absolute path like
  `/assets/index.js` points at the root of the phone's disk and fails. There are further
  traces of mobile intent throughout the repo — Capacitor origins in the CORS allow-list in
  `backend/app.js`, a `capacitor://localhost` redirect branch in
  `backend/controller/payment.js`, and on-screen-keyboard handling in `App.tsx` — but there
  is no Capacitor config or native project committed here.
- **`manualChunks`** groups certain libraries into their own downloadable files so they can
  be cached separately and skipped when not needed. Note: `html2canvas` is listed here but
  is **not** in `frontend/package.json`'s dependencies; only `jspdf` is. Rollup tolerates a
  manual chunk naming a module nothing imports, so this is harmless but stale.
- **`host: '0.0.0.0'`** makes the dev server listen on every network interface rather than
  only `localhost`, so a phone on the same Wi-Fi can reach it — again, mobile testing.
- **`test:`** — the config is imported from `vitest/config`, not `vite`, so the same file
  configures both the bundler and the test runner. See §2.16.

### 2.5 React Router 6, and specifically HashRouter

**What it is.** In an SPA, JavaScript must decide which component to show for which URL.
React Router does that mapping.

**Where ShopSphere uses it.** `frontend/src/App.tsx` — around 45 `<Route>` entries.

```tsx
// frontend/src/App.tsx
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
...
<Route path="/" element={<Home />} />
<Route path="/cart" element={<Cart />} />
<Route path="/success/:orderId" element={<Success />} />
<Route path="/admin/revenue" element={<AdminRevenueDashboard />} />
```

`:orderId` is a **route parameter** — a wildcard segment. The `Success` page reads it with
`useParams()`.

**The important detail is `HashRouter`, not `BrowserRouter`.** These differ in what the
URL looks like:

- `BrowserRouter` produces `https://shop.example.com/cart`
- `HashRouter` produces `https://shop.example.com/#/cart`

Everything after `#` in a URL is the **fragment**, and browsers never send the fragment to
the server. With `BrowserRouter`, if a user refreshes the page while on `/cart`, the browser
asks the server for `/cart`, the server has no such file, and the user gets a 404 — unless
you configure the server to rewrite every unknown path to `index.html`. With `HashRouter`,
the browser only ever asks the server for `/`, so no rewrite rules are needed anywhere.

The repo states this reasoning explicitly in `frontend/Dockerfile`:

```dockerfile
# HashRouter means every client route is a URL fragment (#/...), so the server only
# ever needs to serve the static files at their real paths — no SPA rewrite rules needed.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

**Trade-off.** `#/cart` is uglier and historically worse for search-engine indexing.
For a marketplace whose product pages arguably *should* be indexable, `BrowserRouter` plus
an nginx `try_files` rule would be the better long-term choice. The repo chose deployment
simplicity — and, given Capacitor's `file://` loading (where there is no server to configure
at all), HashRouter is close to mandatory for the mobile path.

### 2.6 Tailwind CSS

**What it is.** A CSS framework where instead of writing style rules in a separate file
and naming things, you apply many tiny single-purpose classes directly in the markup.
`p-4` means padding 4 units; `flex` means display:flex; `text-ink` means colour "ink".

**Where ShopSphere uses it.** `frontend/tailwind.config.js`, `frontend/src/index.css`, and
the `className` attribute of essentially every component.

The interesting part here is **design tokens**. `frontend/src/index.css` defines CSS custom
properties (variables):

```css
:root {
  --color-paper: 247 247 244;
  --color-surface: 255 255 255;
  --color-ink: 25 29 27;
  --color-muted: 99 106 102;
  --color-line: 221 224 219;
  --color-brand: 14 112 92;
  --color-brand-strong: 10 88 72;
  --color-success: 30 126 76;
  --color-danger: 188 55 49;
  --radius-control: 0.5rem;
  --radius-surface: 0.75rem;
}
```

and `frontend/tailwind.config.js` maps semantic names onto them:

```js
colors: {
  paper: 'rgb(var(--color-paper) / <alpha-value>)',
  'paper-raised': 'rgb(var(--color-surface) / <alpha-value>)',
  ink: 'rgb(var(--color-ink) / <alpha-value>)',
  'ink-muted': 'rgb(var(--color-muted) / <alpha-value>)',
  brass: { DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)', ... },
  hairline: 'rgb(var(--color-line) / <alpha-value>)',
  seal: 'rgb(var(--color-danger) / <alpha-value>)',
  moss: 'rgb(var(--color-success) / <alpha-value>)',
}
```

So a component writes `text-ink` (semantic: "main body text colour") rather than
`text-[#191d1b]` (literal). Changing the brand colour is then a one-line edit in
`index.css` rather than a search-and-replace across 14,000 lines of components. The odd
names — paper, ink, brass, hairline, seal, moss — are a deliberate house vocabulary, not
Tailwind defaults.

**Note on versions.** `frontend/package.json` pins `tailwindcss: ^3.4.19`, while the
repository-root `package.json` lists `tailwindcss: ^4.1.4`. The root `package.json` is a
leftover — see §3.2.

### 2.7 Node.js and Express 4

**What Node.js is.** A program that runs JavaScript outside a browser, with extra
abilities browsers deliberately lack: reading files, opening network servers, spawning
other programs.

**What Express is.** A thin framework over Node's built-in HTTP server. Its whole job is:
"a request arrived — which function should handle it, and what should run before that
function?" Those "before" functions are **middleware**.

> **Jargon: middleware.** A function with the signature `(req, res, next)`. `req` is the
> incoming request (URL, headers, body). `res` is how you reply. `next` is a function you
> call to say "I'm done, pass it along to the next middleware or handler." A middleware can
> also *stop* the chain by replying itself and never calling `next` — which is exactly how
> authentication rejection works. Think of it as a series of checkpoints a request passes
> through on the way to its destination.

`backend/app.js` is the complete assembly of that chain, and it is short enough to read
whole (§3.4.2 walks through it line by line).

**Why Express 4 rather than 5, or a different framework.** Express 4 is the version with
by far the largest ecosystem of compatible middleware — `cors`, `cookie-parser`,
`express-rate-limit`, `multer` all target it. Express 5 was still stabilising. Alternatives
like Fastify (faster) or NestJS (more structure, dependency injection, decorators) exist;
Express's advantage for a project this size is that there is almost no framework left to
learn once you understand middleware.

### 2.8 Prisma 7 and PostgreSQL 16

**What PostgreSQL is.** A **relational database**: data lives in tables with fixed columns,
rows are linked to each other by IDs, and the database itself enforces rules ("this column
cannot be null", "this email must be unique", "this order must point at a product that
exists"). It also supports **transactions** — see §4.11.

**What Prisma is.** The layer between the application code and PostgreSQL. It does three
distinct jobs, and it helps to keep them separate in your head:

1. **Schema definition.** `backend/prisma/schema.prisma` describes every table in a
   purpose-built language.
2. **Migrations.** Prisma compares the schema to the database and generates SQL files under
   `backend/prisma/migrations/` that move the database from its old shape to the new one.
3. **Client generation.** From the schema, Prisma generates a typed JavaScript client into
   `backend/generated/prisma/`, giving you `prisma.order.findUnique(...)` with
   autocompletion for every field.

A slice of the schema:

```prisma
model Product {
  id                String    @id @db.VarChar(24)
  name              String
  price             Float
  quantity          Int
  category          String
  sellerId          String?   @db.VarChar(24)
  seller            User?     @relation("ProductSeller", fields: [sellerId], references: [id])

  colorVariants   ProductColorVariant[]
  orders          Order[]

  @@map("products")
}
```

- `@id` marks the primary key — the column that uniquely identifies a row.
- `@db.VarChar(24)` pins the SQL column type to a 24-character string. §4.2 explains why 24.
- `String?` with a `?` means the column is **nullable** — it may be empty. `sellerId` is
  nullable because an admin can create a product with no seller attached
  (`sellerId: req.user.role === 'seller' ? req.user.id : null` in `createProduct`).
- `@relation(...)` declares a **foreign key**: `Product.sellerId` points at `User.id`.
  PostgreSQL will then refuse to store a product whose `sellerId` matches no user.
- `Product[]` on the other side is the reverse of that relation — the list of products a
  user sells. It creates no column; it exists so you can write
  `prisma.user.findUnique({ include: { productsAsSeller: true } })`.
- `@@map("products")` sets the actual SQL table name to lowercase plural while the code
  keeps the singular capitalised model name.

**The driver adapter.** `backend/database/prismaClient.js` is the only place a Prisma client
is created:

```js
import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Loaded defensively here (not just in app.js) because this module is
// imported transitively before app.js's own dotenv.config() line runs.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "config", "config.env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
```

`PrismaPg` is a **driver adapter**: rather than Prisma using its own native query engine
binary, it delegates the actual TCP conversation with Postgres to the well-established `pg`
npm package. Practical upshots: no platform-specific binary to ship, and connection pooling
behaviour is `pg`'s well-understood behaviour.

> **Jargon: connection pool.** Opening a fresh database connection per request is slow
> (a TCP handshake plus authentication each time). A pool keeps a handful of connections
> open and hands them out and back. `pg` does this for you.

Note the defensive `dotenv.config()` inside this file. This is a real ESM gotcha. `import`
statements are **hoisted**: Node resolves and executes every imported module *before*
running any statement in the importing file. So `backend/app.js` imports the routers, which
import controllers, which import `prismaClient.js` — and all of that finishes before
`app.js`'s own `dotenv.config({ path: ... })` line executes. Without the second
`dotenv.config()` here, `process.env.DATABASE_URL` would be `undefined` at the moment
`new PrismaPg(...)` runs.

**Why PostgreSQL rather than MongoDB.** This is not hypothetical — **the project migrated
from MongoDB to PostgreSQL partway through**, and the evidence is all over the repo:
`backend/models/*.js` still contains Mongoose schemas,
`backend/scripts/migrateMongoToPostgres.js` is the one-time ETL script, and `mongoose` and
`mongodb` are still listed in `backend/package.json`. §8.1 covers this migration as a full
case study.

### 2.9 zod

**What it is.** A validation library. You describe the shape you expect, and zod checks a
real value against it at runtime, returning either the parsed value or a list of errors.

**Where ShopSphere uses it.** `backend/controller/auth.js`, `order.js`, `cartController.js`,
`productController.js`, `promoCodeController.js`.

```js
// backend/controller/auth.js
const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: z.enum(["user", "admin", "seller"]),
  shopName: z.string().optional(),
  shopDescription: z.string().optional(),
});

export const register = async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "invalid_input", message: parsed.error.issues[0].message });
  }
  const { firstName, lastName, phone, password, role, shopName, shopDescription } = parsed.data;
  ...
```

`safeParse` returns `{ success: true, data }` or `{ success: false, error }` — it never
throws, so no try/catch is needed. Crucially, the code then uses `parsed.data`, **not**
`req.body`. That is the whole point: from that line on, the handler works with a value that
has been checked field by field, and any extra fields an attacker tried to smuggle in have
been stripped, because `z.object` returns only the declared keys.

**Why validation matters, concretely.** Without it, `createOrder` would do
`quantity: req.body.quantity`, and a client could POST `{"quantity": -5}` or
`{"quantity": "10; DROP TABLE"}` or `{"quantity": {"$gt": 0}}`. With
`quantity: z.coerce.number().int().positive()`, a negative number is a 400 before any
business logic runs. `z.coerce` additionally accepts the string `"3"` and converts it to
the number `3` — useful because HTML forms send everything as strings.

**Coverage is deliberately partial.** Commit `7a5e79f` states that zod was added to "the
remaining money- and content-handling endpoints". `revenueController.js` and
`userManagement.js` still do lighter manual checks:

```js
// backend/controller/revenueController.js
const orderId = typeof req.body?.orderId === "string" ? req.body.orderId : "";
if (!orderId) {
  return res.status(400).json({ message: "orderId is required" });
}
```

That is a conscious prioritisation — validate where money and user-generated content flow
first — not an oversight.

### 2.10 jsonwebtoken

**What a JWT is.** A **JSON Web Token** is a string with three dot-separated parts:
`header.payload.signature`. The header and payload are just JSON, Base64-encoded — **anyone
can read them**; they are not encrypted. The third part is a cryptographic signature made
with a secret key that only the server knows.

The point is not secrecy, it is **tamper-evidence**. The server can hand you a token saying
`{"sub": "abc123", "role": "user"}`, and when you hand it back, the server can verify
nothing was changed — because changing `"role": "user"` to `"role": "admin"` invalidates the
signature, and you cannot compute a valid new signature without the secret.

**Where ShopSphere uses it.** `backend/utils/tokens.js`:

```js
import jwt from "jsonwebtoken";
import { randomBytes, randomUUID, createHash } from "crypto";

const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const signAccessToken = ({ id, role }) =>
  jwt.sign({ sub: id, role, jti: randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

export const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_SECRET);
```

- `sub` ("subject") is the standard JWT claim for "who this token is about" — the user id.
- `role` is a custom claim, so the server can do role checks **without a database read**.
- `jti` ("JWT ID") is a unique id per token. It exists so tokens could be individually
  revoked via a blocklist. **ShopSphere does not currently check `jti` against anything** —
  the old README says so explicitly. It is groundwork, not a live feature.
- `expiresIn: "15m"` bakes an expiry timestamp into the payload; `jwt.verify` rejects
  expired tokens automatically.

§4.6 and §6.1 cover why 15 minutes, and what the refresh token does about it.

### 2.11 @node-rs/argon2 and bcryptjs

**Why passwords are hashed at all.** If a database is ever stolen and it contains plaintext
passwords, every user is compromised — including on other sites, because people reuse
passwords. So you never store the password. You store a **hash**: a one-way transformation.
Given the password you can compute the hash; given the hash you cannot recover the password.
At login you hash what the user typed and compare hashes.

**Why a *slow* hash.** Ordinary hashes like SHA-256 are designed to be fast, which is exactly
wrong here: an attacker with the stolen database can try billions of guesses per second.
Password hashes are deliberately slow and memory-hungry, so each guess costs the attacker
real time and real RAM. **Argon2id** is the current recommended algorithm; **bcrypt** is the
older, still-respectable one.

**Where ShopSphere uses them.** `backend/utils/password.js`, in full:

```js
import { hash, verify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

// memoryCost/timeCost/parallelism match @node-rs/argon2's own defaults; pinned
// explicitly so a future library upgrade can't silently change the work factor.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => hash(password, ARGON2_OPTIONS);

export const isLegacyHash = (passwordHash) => !passwordHash?.startsWith("$argon2");

export const verifyPassword = (passwordHash, password) => {
  if (!passwordHash) return Promise.resolve(false);
  return isLegacyHash(passwordHash)
    ? bcrypt.compare(password, passwordHash)
    : verify(passwordHash, password);
};
```

- `memoryCost: 19456` = roughly 19 MB of RAM per hash attempt. That is the lever that makes
  GPU-based cracking expensive.
- `isLegacyHash` inspects the hash string itself. Argon2 hashes always begin `$argon2`;
  bcrypt hashes begin `$2a$`/`$2b$`. So the format is self-describing and no extra database
  column is needed to remember which algorithm was used.
- `verifyPassword` therefore speaks **both** algorithms transparently.

The migration is completed opportunistically at login, in `backend/controller/auth.js`:

```js
// Opportunistic upgrade: this user still had a pre-argon2 (bcrypt) hash.
if (isLegacyHash(user.password)) {
  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(password) },
  });
}
```

This runs *after* the password has been verified, which is the only moment the server ever
legitimately holds the plaintext password and can therefore re-hash it. Users are upgraded
silently, one login at a time, with no forced password reset. Any user who never logs in
again keeps their bcrypt hash forever — acceptable, since bcrypt is not broken.

One inconsistency worth knowing: `backend/utils/seedAdmin.js` still uses
`bcrypt.hash(password, 12)` for the bootstrapped admin account. That admin will be upgraded
to Argon2id on its first login by the code above.

### 2.12 cookie-parser, cors, express-rate-limit, multer

**cookie-parser.** Cookies arrive as one long header string. This middleware parses it into
`req.cookies`, an object. Registered in `backend/app.js` as `app.use(cookieParser())`, and
consumed in `backend/controller/auth.js`:

```js
const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
```

**cors.** Explained fully in §4.13 and §6.6.

**express-rate-limit.** Caps how many requests one IP address may make in a window. Used in
exactly one place, `backend/routes/authRoute.js`:

```js
// Blunts credential stuffing / brute force against register and login.
const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

authRouter.post('/register', credentialsLimiter, register);
authRouter.post('/login', credentialsLimiter, login);
```

20 attempts per IP per 15 minutes. Enough for a human who forgot their password; useless for
an attacker trying a leaked password list. **Known limitation**, stated in the old README:
the default store is in-memory, so if you run two backend instances, each keeps its own
counter and the effective limit doubles. Fixing that means a shared store (Redis).

**multer.** Handles `multipart/form-data`, the encoding browsers use to upload files. Two
separate configurations exist:

```js
// backend/routes/productRoute.js — product images, minimal config
const upload = multer({ dest: "uploads/" });
...
productRouter.post("/uploadImage", verifyToken, authorizeSeller, checkSellerVerification,
                   upload.array("images", 3), uploadImage);
```

```js
// backend/routes/orderRoute.js — return-defect photos, hardened
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `return-${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },        // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error("Only image files (jpg, jpeg, png, webp) are allowed"));
  }
});
```

The return-upload path enforces a size cap and a type check on both the file extension and
the declared MIME type. The product-image path (`multer({ dest: "uploads/" })`) enforces
neither, beyond a maximum of 3 files. It is gated behind
`verifyToken` → `authorizeSeller` → `checkSellerVerification`, so only an admin-approved
seller can reach it — but an approved seller could upload a 2 GB file or a `.exe`. That is
an inconsistency worth knowing about; see §8.7.

**Why serving uploads from local disk is a scaling limit.**
`app.use("/uploads", express.static(...))` serves files straight off the backend container's
filesystem. In `docker-compose.yml` that directory is a named volume
(`backend_uploads:/app/uploads`). Run two backend containers and each has its own volume: an
image uploaded to instance A 404s on instance B. The standard fix is object storage (S3 or
equivalent) plus a CDN. §6.9.

### 2.13 axios

**What it is.** An HTTP client for the browser. It wraps the browser's built-in `fetch`
with conveniences: automatic JSON parsing, non-2xx responses becoming errors, and —
critically for ShopSphere — **interceptors**.

> **Jargon: interceptor.** A function that runs on every request before it is sent, or on
> every response before your code sees it. It is middleware for the client side.

`frontend/src/lib/session.ts` uses both, and this is the single most architecturally
important file in the frontend:

```ts
axios.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthRoute = AUTH_PATHS.some((path) => original?.url?.includes(path));
    if (error.response?.status === 401 && original && !original._retriedAfterRefresh && !isAuthRoute) {
      original._retriedAfterRefresh = true;
      const token = await refreshSession();
      if (token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return axios(original);
      }
    }
    return Promise.reject(error);
  }
);
```

The **request** interceptor stamps the current access token onto every outgoing request.
The **response** interceptor implements silent re-authentication: if any request comes back
`401 Unauthorized`, it tries to get a fresh access token and **replays the original request**.
From the user's point of view nothing happened — no logout, no redirect, no lost form data.

Three guards keep this from going wrong:

- `!original._retriedAfterRefresh` — a flag stamped on the request object so a single request
  is retried at most once. Without it, a genuinely-forbidden request would loop forever.
- `!isAuthRoute` — a 401 from `/auth/login` means "wrong password", not "expired token".
  Refreshing in response to that would be nonsense.
- Inside `refreshSession`, a module-level `refreshPromise` variable ensures that if ten
  requests 401 simultaneously, only **one** refresh call is made and all ten await the same
  promise. Without this, ten concurrent rotations would race and — because rotation marks the
  old token used — nine of them would trip the reuse detector and log the user out. This is
  a subtle and important detail.

**This is why almost no page in the frontend has to think about authentication.** They call
`axios.get(url)` and the token appears. §8.4 covers what happens on the pages that use raw
`fetch()` instead and therefore miss all of this.

### 2.14 Sonner, lucide-react, Radix UI, Recharts, jsPDF

- **sonner** — toast notifications, the small messages that slide in to say "Order created!".
  Mounted once in `frontend/src/main.tsx` as `<Toaster />`; any component then calls
  `toast.success("...")`.
- **lucide-react** — SVG icon set. `import { ShoppingCart } from 'lucide-react'`.
- **@radix-ui/react-\*** — unstyled but fully accessible UI primitives (avatar, separator,
  slot, tabs). Radix handles keyboard navigation, focus trapping, and ARIA attributes;
  Tailwind handles the looks. `frontend/components.json` shows the project was scaffolded
  with **shadcn/ui**, a convention of copying Radix-based components into your own repo
  rather than installing them as a dependency.
- **recharts** — the charts on `AdminRevenueDashboard.tsx` and `SellerRevenueDashboard.tsx`.
- **jspdf** — generates the PDF receipt in `frontend/src/pages/Success.tsx`, entirely in the
  browser. No server-side PDF rendering exists.

### 2.15 groq-sdk and @google/generative-ai

**Groq** is an inference provider — it runs open-weight large language models very fast.
`backend/routes/chatRoute.js` calls it with the model `llama-3.1-8b-instant`.

`@google/generative-ai` is listed in `backend/package.json` but, at time of writing, is not
imported by any file in `backend/`. It is a leftover from an earlier chatbot attempt.

### 2.16 Testing: node --test and Vitest

**Backend: Node's built-in test runner.** No framework installed at all —
`backend/package.json` declares `"test": "node --test"`, and Node 20 discovers and runs every
`*.test.js`.

```js
// backend/utils/pagination.test.js
import assert from "node:assert/strict";
import test from "node:test";
import { parsePagination } from "./pagination.js";

test("no page/limit in query stays unpaginated with a hard cap", () => {
  const result = parsePagination({});
  assert.equal(result.paginated, false);
  assert.deepEqual(result.prismaArgs, { take: 1000 });
});
```

The clever architectural bit is **how the tests avoid needing a database**. Every function
that touches Prisma accepts the client as a parameter with a default:

```js
// backend/controller/order.js
export const adjustStock = async (productId, quantity, selectedColor, selectedStorage,
                                  sign, client = prisma) => {
```

Production code omits the argument and gets the real client. Tests pass a hand-written fake:

```js
// backend/controller/order.test.js
test("adjustStock deducts base quantity plus the selected color/storage variant", async () => {
  const client = createFakeStockPrisma({
    id: "p1", quantity: 10,
    colorVariants: [{ color: "Black", stock: 4 }, { color: "White", stock: 6 }],
    storageVariants: [{ storage: "128GB", stock: 3 }],
  });

  const updated = await adjustStock("p1", 2, "Black", "128GB", -1, client);

  assert.equal(updated.quantity, 8);
  assert.equal(client.store.colorVariants.find((c) => c.color === "Black").stock, 2);
  assert.equal(client.store.colorVariants.find((c) => c.color === "White").stock, 6); // untouched
  assert.equal(client.store.storageVariants.find((s) => s.storage === "128GB").stock, 1);
});
```

> **Jargon: dependency injection.** Passing a dependency in from outside rather than
> hard-coding it inside. It is what makes this style of testing possible without any mocking
> library. The same `client = prisma` parameter serves a second purpose in production: it is
> how a `$transaction` handle gets threaded through — see §4.11.

The consequence for the build pipeline is direct: `.github/workflows/ci.yml` needs no
Postgres service container, because the backend suite touches no database.

Test files present: `backend/controller/order.test.js`,
`backend/controller/productController.test.js`, `backend/database/dbConnection.test.js`,
`backend/utils/pagination.test.js`, `backend/utils/password.test.js`,
`backend/utils/refreshTokenStore.test.js`, `backend/utils/seedAdmin.test.js`,
`backend/utils/seedDemoData.test.js`.

**Frontend: Vitest + React Testing Library.** Vitest is a test runner that reuses Vite's
transform pipeline, so TypeScript and JSX work with no extra setup. React Testing Library
renders components into a simulated DOM (**jsdom**) and lets you assert on what a *user*
would see.

```tsx
// frontend/src/components/catalog/catalog.test.tsx
it('states discount and low inventory in text', () => {
  renderRoute(<ProductCard product={product} onOpen={vi.fn()} />);

  expect(screen.getByText('20% off')).toBeVisible();
  expect(screen.getByText('Only 3 left')).toBeVisible();
  expect(screen.getByText('Rs. 120,000')).toBeVisible();
});

it('gives guests one clear product action', () => {
  renderRoute(<ProductCard product={product} onOpen={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'View iPhone 17 Pro' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
});
```

Note `getByRole('button', { name: ... })` — querying by **accessible role and name**, the
same way a screen reader finds things. A test written that way fails if the component stops
being reachable by assistive technology, which a `querySelector('.btn')` test would not catch.

`frontend/src/test/render.tsx` provides a shared helper that wraps components in a
`MemoryRouter`, needed because components using `<Link>` or `useNavigate` crash outside a
router context.

### 2.17 Docker and Docker Compose

**What Docker is.** A container packages an application together with its runtime,
libraries, and files, so it runs identically anywhere. **Docker Compose** describes several
containers and how they connect, in one YAML file.

`docker-compose.yml` defines three services: `postgres`, `backend`, `frontend`. Four details
are worth understanding:

- **`healthcheck` + `condition: service_healthy`.** `depends_on` alone only waits for the
  container to *start*, not for Postgres inside it to be *ready to accept connections*.
  Without the healthcheck, the backend would start, fail to connect, and — because
  `server.js` calls `process.exit(1)` on connection failure — die.
- **`volumes`.** Containers are ephemeral; delete one and its filesystem goes with it. A
  named volume (`postgres_data`, `backend_uploads`) is storage that outlives the container,
  so data and uploads survive `docker compose down`.
- **The `DATABASE_URL` override.** `env_file` loads `config.env`, which for local development
  points at `localhost:5432`. Inside the Compose network, "localhost" means *this container*,
  not the Postgres container. So `environment:` overrides it with `postgres:5432` — the
  service name, which Compose resolves via internal DNS. The inline comment in the file says
  exactly this.
- **`5173:80`.** Host port 5173 maps to container port 80, so the containerised nginx build
  is reachable at the same URL developers already use for the Vite dev server.

The `backend/Dockerfile` has one line that deserves attention:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node server.js"]
```

Migrations run on every container start, before the server boots. The comment is honest
about the trade-off: fine at this scale, but it means N replicas all race to migrate on
deploy. The usual upgrade is a separate one-shot migration job.

`frontend/Dockerfile` is a **multi-stage build**: stage one uses `node:20-alpine` to run
`npm run build`; stage two copies only the resulting `dist/` folder into `nginx:alpine`.
The final image contains no Node.js and no `node_modules` — a few tens of megabytes instead
of several hundred.

### 2.18 GitHub Actions

**What it is.** Continuous Integration: on every push, a fresh virtual machine checks out
the code and runs your checks, so broken code is caught before anyone else pulls it.

`.github/workflows/ci.yml` defines two independent jobs that run in parallel:

```yaml
jobs:
  backend:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci
      - run: npm test

  frontend:
    steps:
      - ... same setup with frontend/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
```

`npm ci` (not `npm install`) installs exactly the versions pinned in `package-lock.json`,
guaranteeing CI tests what will actually ship. The frontend job additionally runs
`npm run build`, which catches TypeScript errors and broken imports that the tests alone
would miss.

There is **no lint gate** — the old README states this is because the frontend has
pre-existing ESLint findings that predate the pipeline, and failing CI on them would block
every PR.

### 2.19 Python, pandas, mlxtend

**What it is for.** The "customers who bought this also bought…" feature. The algorithm is
**Apriori**, a classic market-basket analysis method. Given a list of past transactions, it
finds sets of items that frequently appear together, then derives rules of the form
"if a basket contains A, it often also contains B".

**Where it lives.** `backend/recommendation/`:
- `train_apriori.py` — the training script (194 lines)
- `data/Final_Apple_Apriori_Dataset_v2.csv` — 10,001 lines of transactions
- `requirements.txt` — `pandas`, `mlxtend`, `scikit-learn`
- `README.md` — usage instructions

**Crucially, this is offline.** No Python runs when a customer loads a page. The script is
run by hand, produces `output/recommendations_map.json`, and the Node backend reads that
static file. §4.15 covers this fully, including two facts you need to know: the `output/`
directory is gitignored and **currently absent**, so recommendations always fall back to
"same category"; and the admin retrain endpoint points at a filename that no longer exists.
---

## 3. Directory Structure and Files

### 3.1 The complete tree

Directories that are generated or downloaded (`node_modules/`, `frontend/dist/`,
`backend/generated/prisma/`, `backend/uploads/`) are marked but not expanded.

```text
Shopsphere/
├── .github/
│   └── workflows/ci.yml            GitHub Actions: backend tests, frontend tests + build
├── .gitignore                      Root ignore rules
├── docker-compose.yml              Postgres + backend + frontend, wired together
├── package.json                    LEGACY root manifest — see §3.2
├── package-lock.json               Lockfile for the legacy root manifest
├── docs/                           Empty directory
│
├── backend/
│   ├── server.js                   ENTRY POINT: connect DB, listen, graceful shutdown
│   ├── app.js                      Express app assembly: middleware chain + router mounts
│   ├── package.json                Backend dependencies and scripts
│   ├── Dockerfile                  Node 20 image; runs migrations then server
│   ├── .dockerignore
│   ├── .env                        (present, gitignored at frontend level; see §3.2)
│   ├── skills-lock.json            Tooling metadata: pinned Prisma editor-assistant skills
│   ├── prisma.config.ts            Tells the Prisma CLI where schema/migrations/URL live
│   │
│   ├── config/
│   │   ├── config.env              REAL SECRETS — gitignored
│   │   └── config.env.example       Committed template with placeholder values
│   │
│   ├── prisma/
│   │   ├── schema.prisma           THE data model — 16 models
│   │   └── migrations/
│   │       ├── 20260823153901_init/migration.sql              353 lines: 13 tables
│   │       ├── 20260824183302_add_payment_layer/migration.sql  60 lines: payments + idempotency
│   │       ├── 20260824183326_ledger_append_only/migration.sql  4 lines: REVOKE UPDATE,DELETE
│   │       ├── 20260824184952_add_refresh_tokens/migration.sql 25 lines: refresh_tokens
│   │       └── migration_lock.toml  Records provider = postgresql
│   │
│   ├── generated/prisma/           GENERATED by `prisma generate` — gitignored, never edit
│   │
│   ├── database/
│   │   ├── prismaClient.js         Creates the single shared PrismaClient
│   │   ├── dbConnection.js         Connect + seed admin + optionally seed demo data
│   │   └── dbConnection.test.js
│   │
│   ├── middlewares/
│   │   ├── authMiddleware.js       authenticate / authorizeAdmin / authorizeSeller /
│   │   │                           checkSellerVerification
│   │   └── error.js                Central Express error handler + ErrorHandler class
│   │
│   ├── routes/                     One router per domain; URL shapes only, no logic
│   │   ├── authRoute.js            /api/v1/auth
│   │   ├── productRoute.js         /api/v1/product
│   │   ├── orderRoute.js           /api/v1/order
│   │   ├── paymentRoute.js         /api/v1/payment
│   │   ├── cartRoute.js            /api/v1/cart
│   │   ├── revenueRoute.js         /api/v1/revenue
│   │   ├── userManagementRoute.js  /api/v1/users
│   │   ├── promoCodeRoute.js       /api/v1/promo
│   │   ├── notificationRoute.js    /api/v1/notifications
│   │   ├── chatRoute.js            /api/v1/chat   (logic lives here, not in a controller)
│   │   └── testEmailRoute.js       /api/v1/email  (diagnostic, unauthenticated)
│   │
│   ├── controller/                 All business logic
│   │   ├── auth.js                    417 lines
│   │   ├── productController.js       877 lines
│   │   ├── productController.test.js   44 lines
│   │   ├── order.js                  1755 lines  ← largest file in the repo
│   │   ├── order.test.js               99 lines
│   │   ├── payment.js                 216 lines
│   │   ├── cartController.js          291 lines
│   │   ├── promoCodeController.js     460 lines
│   │   ├── revenueController.js       252 lines
│   │   ├── notificationController.js   79 lines
│   │   └── userManagement.js          203 lines
│   │
│   ├── utils/
│   │   ├── tokens.js               Sign/verify access tokens; generate/hash refresh tokens
│   │   ├── refreshTokenStore.js    Refresh-token families, rotation, reuse detection
│   │   ├── password.js             Argon2id hashing with bcrypt legacy read path
│   │   ├── idempotency.js          withIdempotency(): run a handler exactly once per key
│   │   ├── esewa.js                HMAC signing, callback verification, status check
│   │   ├── pagination.js           parsePagination(): opt-in page/limit handling
│   │   ├── generateId.js           24-hex-char ID generator (MongoDB ObjectId shape)
│   │   ├── emailService.js         sendEmail() via nodemailer; never throws
│   │   ├── seedAdmin.js            Bootstraps the configured admin account
│   │   ├── seedDemoData.js         Optional demo sellers/customers/products
│   │   └── *.test.js               Unit tests alongside each of the above
│   │
│   ├── models/                     LEGACY Mongoose schemas — used only by the ETL script
│   │   ├── userSchema.js  productSchema.js  orderSchema.js  cartSchema.js
│   │   ├── revenueSchema.js  notificationSchema.js  promoCodeSchema.js  billSchema.js
│   │
│   ├── scripts/
│   │   └── migrateMongoToPostgres.js   One-time Mongo → Postgres ETL (437 lines)
│   │
│   ├── chatbot/
│   │   └── faqs.json               Static FAQ knowledge base injected into the LLM prompt
│   │
│   ├── recommendation/
│   │   ├── README.md               How to train the model
│   │   ├── requirements.txt        pandas, mlxtend, scikit-learn
│   │   ├── train_apriori.py        The offline training script
│   │   ├── data/Final_Apple_Apriori_Dataset_v2.csv
│   │   └── output/                 GENERATED, gitignored — currently ABSENT
│   │
│   └── uploads/                    Uploaded images — gitignored
│
└── frontend/
    ├── index.html                  The single HTML shell the SPA mounts into
    ├── package.json
    ├── vite.config.ts              Bundler + Vitest config
    ├── tailwind.config.js          Design tokens mapped to Tailwind names
    ├── postcss.config.js           Runs Tailwind + autoprefixer over the CSS
    ├── eslint.config.js
    ├── tsconfig.json / .app.json / .node.json
    ├── components.json             shadcn/ui scaffolding config
    ├── Dockerfile                  Multi-stage: node build → nginx serve
    ├── .env                        VITE_BACKEND_URL, VITE_GOOGLE_CLIENT_ID
    │
    ├── public/
    │   ├── favicon.svg
    │   └── images/                 ~55 product/marketing images
    │
    └── src/
        ├── main.tsx                React entry: mounts <App/> and <Toaster/>
        ├── App.tsx                 Router, 45 routes, lazy loading, Google OAuth provider
        ├── index.css               Design tokens + Tailwind layers + global styles
        ├── vite-env.d.ts           Types for import.meta.env
        │
        ├── lib/
        │   ├── session.ts          THE auth module: in-memory token + axios interceptors
        │   └── utils.ts            cn() class merger + getImageUrl() host rewriter
        │
        ├── components/
        │   ├── NavBar.tsx  Footer.tsx  OrbitMark.tsx
        │   ├── NotificationBell.tsx    Polls /notifications every 30s
        │   ├── ChatWidget.tsx          Floating chatbot
        │   ├── ui/                     Button, Field, Status, AsyncState, sonner + tests
        │   ├── auth/RoleSelector.tsx + tests
        │   ├── catalog/                ProductCard, Money + tests
        │   ├── checkout/CartSummary.tsx + tests
        │   ├── layout/layout.test.tsx
        │   └── operations/             ActionList, PageHeader + tests
        │
        ├── pages/                  45 route components (see §3.6)
        │
        └── test/
            ├── setup.ts            jest-dom matchers, cleanup, scrollIntoView stub
            └── render.tsx          renderRoute() helper wrapping in MemoryRouter
```

### 3.2 Why there are three `package.json` files

This confuses everyone the first time. There are three, and only two matter.

**`backend/package.json`** — real. Declares the backend's dependencies and the
`start` / `dev` / `test` scripts. `npm install` here creates `backend/node_modules`.

**`frontend/package.json`** — real. Declares the frontend's dependencies and the
`dev` / `build` / `preview` / `test` / `test:watch` scripts.

**`/package.json`** (repository root) — **legacy, effectively dead.** Its contents:

```json
{
  "type": "module",
  "dependencies": { "multer": "^1.4.5-lts.2", "react-router-dom": "^7.5.2", "vite": "^6.3.3" },
  "devDependencies": { "@types/react-router-dom": "^5.3.3", "autoprefixer": "^10.4.21",
                       "postcss": "^8.5.3", "tailwindcss": "^4.1.4" },
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" }
}
```

It mixes a backend dependency (`multer`) with frontend ones, and pins **different major
versions** than the real manifests: `react-router-dom` 7 vs the frontend's 6, `vite` 6 vs 5,
`tailwindcss` 4 vs 3. There is no `vite.config` at the root, so `npm run dev` here would
find nothing to build. Neither Dockerfile nor either CI job references it.

This is an archaeological artefact from before the repository was split into `backend/` and
`frontend/`. **Deleting it (and its lockfile) would be safe and would remove a real source of
confusion** — a newcomer running `npm install` at the root gets the wrong versions of
everything. It is called out again in §8.8.

There is also a `backend/.env` file alongside `backend/config/config.env`. The application
only ever loads `config/config.env` — both `app.js` and `prismaClient.js` name that exact
path — so `backend/.env` is not read by the running app.

### 3.3 Directory-by-directory purpose

#### `backend/routes/` — the URL map

**Purpose.** Declare *what URLs exist*, *which HTTP method each accepts*, *which middleware
guards it*, and *which controller function handles it*. Nothing else. No business logic, no
database calls.

**Why separate from controllers.** You can answer "what does this API expose and who can
reach it?" by reading eleven short files, without reading five thousand lines of logic. It
also means the security posture of the whole API is auditable at a glance.

**How it connects.** `backend/app.js` imports each router and mounts it under a prefix. Each
router imports its controller functions and the middleware it needs.

**The main exception.** `backend/routes/chatRoute.js` contains its full handler inline —
Groq calls, prompt construction, product fetching — rather than delegating to a controller.
`backend/routes/testEmailRoute.js` does the same. Two smaller exceptions live in
`authRoute.js` (`GET /me` and `PUT /profile` are written inline) and `orderRoute.js`
(a `/user/debug/info` diagnostic handler).

#### `backend/controller/` — the business logic

**Purpose.** Everything that decides *what actually happens*: validate the request, read and
write the database, call external services, compute prices and commissions, send emails,
build the response.

**Why it exists as a layer.** Routes describe shape; controllers describe behaviour.
Keeping them apart means a function like `confirmOrderCore` can be called both from an HTTP
route *and* from the payment webhook — which is exactly what `backend/controller/payment.js`
does:

```js
// backend/controller/payment.js
import { confirmOrderCore } from "./order.js";
...
if (newStatus === "Succeeded") {
  try {
    await confirmOrderCore(payment.orderId);
  } catch (confirmErr) {
    console.error("Post-payment order confirmation failed:", confirmErr);
  }
}
```

That reuse is only possible because `confirmOrderCore` takes an order id and returns a
result, rather than taking `(req, res)`. This is the single most important structural idea in
the backend and §4.9 returns to it.

**Honest note on layering.** There is no separate "service" layer. Controllers talk to Prisma
directly. For a codebase this size that is a reasonable simplification — but it is why
`order.js` is 1,755 lines, mixing HTTP handling, stock arithmetic, revenue accounting, and
several hundred lines of inline HTML email templates.

#### `backend/middlewares/` — the checkpoints

Two files. `authMiddleware.js` provides four guards (§3.4.5). `error.js` provides the
last-resort error handler (§3.4.6).

#### `backend/utils/` — reusable, framework-free helpers

**Purpose.** Logic that is not about HTTP at all. None of these files import Express or
touch `req`/`res`. That is what makes them unit-testable in isolation, and it is why six of
the eleven have a `.test.js` sibling.

#### `backend/database/` — connection and startup

Two files: `prismaClient.js` creates the one shared client; `dbConnection.js` runs the boot
sequence.

#### `backend/prisma/` — schema and migrations

`schema.prisma` is the single declaration of the data model. `migrations/` holds the ordered
SQL that has been applied to real databases.

> **Jargon: migration.** A recorded, ordered change to the database structure. You never
> hand-edit a production database; you write a migration, commit it, and every environment
> applies the same ordered list. That is how a colleague's laptop, the CI runner, and
> production all end up with an identical schema.

#### `backend/models/` — the Mongoose ghost

**Eight files of legacy MongoDB schemas.** They are *not* used by the running application.
A search confirms it: the only file in the whole backend that imports from `models/` is
`scripts/migrateMongoToPostgres.js`.

Why keep them? Because the ETL script needs them to *read* the old Mongo database. Once the
migration is confirmed complete everywhere, `models/`, `scripts/`, and the `mongoose` /
`mongodb` dependencies can all be deleted together.

They are still valuable as documentation: `orderSchema.js` shows the validation rules
(`minLength: [2, "First name must be at least 2 characters long"]`) that Mongoose used to
enforce and that zod now replaces.

#### `backend/chatbot/` and `backend/recommendation/`

Data and offline tooling, not runtime code. `faqs.json` is read once at module load in
`chatRoute.js`. `recommendation/` holds the Python training pipeline.

#### `frontend/src/pages/` vs `frontend/src/components/`

**pages/** — one file per route. Each owns its own data fetching and page-level state.
**components/** — reusable pieces used by many pages.

The split is not perfectly clean: `NavBar.tsx`, `Footer.tsx`, `ChatWidget.tsx`, and
`NotificationBell.tsx` sit at the top level of `components/`, while newer, more focused
components are grouped into subfolders by domain (`catalog/`, `checkout/`, `auth/`,
`operations/`, `ui/`). The subfolders are the newer convention — note that each has a
co-located `*.test.tsx`, which the top-level components do not.

### 3.4 File-by-file: the backend core

#### 3.4.1 `backend/server.js`

**Purpose.** The process entry point. `npm start` runs `node server.js`.

**Why it exists separately from `app.js`.** `app.js` *builds* the Express application but
never starts a server. `server.js` starts it. That separation means a test could import
`app` and make fake requests against it without binding a real TCP port.

**Full contents, annotated:**

```js
// dotenv is loaded by app.js with the correct absolute path

import app from "./app.js";
import { prisma } from "./database/prismaClient.js";
import { dbConnection } from "./database/dbConnection.js";

const PORT = process.env.PORT || 4000;

try {
    await dbConnection();
} catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exit(1);
}

const server = app.listen(PORT, () => {
    console.log(`Server Running On Port ${PORT}`);
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`\n❌ Port ${PORT} is already in use.`);
        console.error(`   Run this to fix it: lsof -ti:${PORT} | xargs kill -9`);
        process.exit(1);
    } else {
        throw err;
    }
});

// Graceful shutdown — releases port automatically on Ctrl+C or kill
const shutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
        await prisma.$disconnect();
        console.log(`✅ Port ${PORT} released. Server stopped.`);
        process.exit(0);
    });
};

process.on("SIGINT", () => shutdown("SIGINT"));   // Ctrl+C
process.on("SIGTERM", () => shutdown("SIGTERM")); // kill <pid>
```

- **`await dbConnection()` before `app.listen`.** Order matters. The server refuses to accept
  a single request until the database is reachable. **Fail fast**: a server that accepts
  traffic and then 500s on every request is worse than one that never starts, because
  orchestrators like Kubernetes or Compose can detect and react to the latter.
- **`process.exit(1)`.** A non-zero exit code is the Unix convention for "I failed". Docker
  Compose's `restart: unless-stopped` will then retry.
- **`EADDRINUSE`.** "Address already in use" — you started the server twice. The handler
  prints the exact command to fix it. Small touch, saves real time.
- **Graceful shutdown.** `SIGINT` is Ctrl+C; `SIGTERM` is what Docker sends on
  `docker stop`. `server.close()` stops accepting *new* connections but lets in-flight
  requests finish; only then does it disconnect Prisma and exit. Without this, killing the
  container mid-request could drop a half-finished database operation.

**Connects to:** `app.js` (the Express app), `prismaClient.js` (for `$disconnect`),
`dbConnection.js` (the boot sequence).

#### 3.4.2 `backend/app.js`

**Purpose.** Assemble the Express application: the middleware chain, then the routers.

**Why it exists.** It is the single place where you can see the entire request pipeline, in
execution order.

Walking through it in order:

```js
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, 'config', 'config.env') });
```

ES modules have no `__dirname` global (CommonJS did), so it is reconstructed from
`import.meta.url`. An **absolute** path is then built to `config/config.env`. Absolute
matters: a relative path would resolve against whatever directory the process was launched
from, so `node backend/server.js` from the repo root would silently load nothing.

```js
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
            origin === 'capacitor://localhost' ||
            origin === 'http://localhost' ||
            origin === process.env.FRONTEND_URL ||
            /^http:\/\/localhost:\d+$/.test(origin) ||
            /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
            /^http:\/\/192\.168\./.test(origin) ||
            /^http:\/\/10\./.test(origin) ||
            /^http:\/\/172\./.test(origin)  // allow LAN + hotspot IPs
        ) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
}));
```

Explained fully in §4.13 and §6.6. Two things to notice now: `credentials: true` is what
permits the browser to send the refresh cookie cross-origin at all; and `!origin` returning
`true` allows tools like `curl` and server-to-server calls, which send no `Origin` header.

```js
// ponytail: hand-rolled instead of pulling in helmet for a handful of static headers.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
});
```

Four security headers, hand-written rather than pulling in the `helmet` package. Each:

- **`X-Content-Type-Options: nosniff`** — browsers sometimes ignore the declared
  `Content-Type` and guess from content ("MIME sniffing"). If an attacker uploads a file
  that is really JavaScript but declared as an image, sniffing could cause it to execute.
  `nosniff` disables the guessing.
- **`X-Frame-Options: DENY`** — forbids any site from embedding these pages in an
  `<iframe>`. Prevents **clickjacking**: an attacker overlays an invisible frame of your
  site on their page, so a user who thinks they are clicking "Play video" is actually
  clicking "Delete account" on your site.
- **`Referrer-Policy: no-referrer`** — stops the browser telling third-party sites which
  page the user came from. If a URL ever contains an order id, that id stops leaking.
- **`Strict-Transport-Security`** (production only) — tells the browser "for the next 180
  days, always use HTTPS for this domain, never plain HTTP". Blocks an attacker who
  downgrades the first request to HTTP to read it. It is production-only because forcing
  HTTPS on `localhost` during development breaks it.

```js
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
```

`express.json()` parses a JSON request body into `req.body`. Without it, `req.body` is
`undefined` and every zod schema fails. `express.urlencoded` does the same for HTML form
encoding. `cookieParser()` populates `req.cookies`.

```js
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/product', productRouter);
app.use('/api/v1/order', orderRouter);
app.use('/api/v1/payment', paymentRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/revenue', revenueRouter);
app.use('/api/v1/users', userManagementRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/promo', promoRouter);
app.use('/api/v1/email', testEmailRouter);
app.use("/uploads", express.static(join(__dirname, "uploads")));
```

Each router is mounted under a prefix. Inside `authRoute.js`, a route declared as `/login`
therefore answers at `/api/v1/auth/login`.

> **Why `/api/v1/`?** The `v1` is **API versioning**. If a future change must break existing
> clients — a renamed field, a different response shape — you can publish `/api/v2/` beside
> it and give old clients time to migrate. Without a version in the path, your only options
> are to break clients or to never change anything. Relevant here because there is a mobile
> app path (Capacitor): an installed app cannot be force-updated the way a web page can.

```js
app.get('/esewa-success/:orderId', (req, res) =>
  res.redirect(`/api/v1/payment/esewa/success/${req.params.orderId}?${new URLSearchParams(req.query).toString()}`));
app.get('/esewa-failure/:orderId', (req, res) =>
  res.redirect(`/api/v1/payment/esewa/failure/${req.params.orderId}?${new URLSearchParams(req.query).toString()}`));
```

The comment above these lines is one of the most instructive in the codebase:

```js
// eSewa redirects the browser here after payment. These used to redirect straight to the
// frontend with zero server-side verification (the frontend then trusted the redirect alone
// and deducted stock). Real verification now lives in paymentRouter's /esewa/success|failure
// routes; kept here only as aliases in case an old client build still points at these paths.
```

That is a **security vulnerability described in the past tense**, plus a
**backward-compatibility shim**. §8.2 makes it a full case study.

```js
app.use(errorMiddleware)
```

Registered **last**, so it only sees errors that fell through everything else.

#### 3.4.3 `backend/database/prismaClient.js`

**Purpose.** Create exactly one `PrismaClient` for the whole process and export it.

**Why one.** Each client owns a connection pool. Creating one per request would exhaust
Postgres's connection limit almost immediately. Because ES modules are **singletons** —
Node executes a module's body once, no matter how many files import it — every importer
receives the same object.

**Connects to:** imported by every controller, by `dbConnection.js`, by
`refreshTokenStore.js`, `idempotency.js`, `seedAdmin.js`, and `server.js`.

#### 3.4.4 `backend/database/dbConnection.js`

**Purpose.** The boot sequence: connect, guarantee an admin exists, optionally seed demo data.

```js
export const initializeDatabase = async ({
  client = prisma,
  demoEnabled = process.env.SEED_DEMO_DATA === "true",
  seedDefaultAdmin = ensureDefaultAdmin,
  seedDemo = ensureDemoData,
} = {}) => {
  await client.$connect();
  console.log("Connected to database successfully!");
  await seedDefaultAdmin();

  if (demoEnabled) {
    const seeded = await seedDemo(client);
    console.log(
      `✅ Demo data ensured: ${seeded.usersCreated} users and ${seeded.productsCreated} products created; ` +
      `${seeded.usersExisting} users and ${seeded.productsExisting} products already existed`,
    );
  }
};

export const dbConnection = () => initializeDatabase();
```

Every dependency — the client, the flag, and both seed functions — is a **parameter with a
default**. Production calls `dbConnection()` and gets the real behaviour. The test calls
`initializeDatabase({ client: fake, demoEnabled: false, seedDefaultAdmin: spy, seedDemo: spy })`
and asserts on call order:

```js
// backend/database/dbConnection.test.js
assert.deepEqual(calls, ["connect", "admin"]);
```

**Why seed an admin at boot.** Chicken-and-egg: only an admin can approve sellers, but there
is no way to create an admin through the API without already being one. Bootstrapping from
environment variables breaks the cycle.

`backend/utils/seedAdmin.js` is careful about it:

```js
export const bootstrapAdmin = async ({ client, email, password }) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { status: "skipped", reason: "missing-config" };
  }

  const existingUser = await client.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    return verifyAdminRole(existingUser, normalizedEmail);
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  try {
    await client.user.create({ data: { id: generateId(), firstName: "ShopSphere",
      lastName: "Admin", email: normalizedEmail, password: hashedPassword,
      role: "admin", isVerified: true } });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const concurrentUser = await client.user.findUnique({ where: { email: normalizedEmail } });
    if (!concurrentUser) throw error;
    return verifyAdminRole(concurrentUser, normalizedEmail);
  }
  return { status: "created", email: normalizedEmail };
};
```

- **No hardcoded default credentials.** If `ADMIN_EMAIL`/`ADMIN_PASSWORD` are unset it skips
  with a warning. A default `admin/admin` would be an instant compromise on any deployment
  where someone forgot to configure it.
- **Idempotent.** Existing account is left completely untouched — importantly, its password
  is *not* reset to the env-var value on every restart.
- **P2002 is handled.** That is Prisma's unique-constraint-violation code. If two instances
  boot simultaneously, one wins the insert and the other catches P2002 and re-reads. This is
  the same "let the database arbitrate the race" pattern used by the idempotency layer (§4.10).
- **Role assertion.** If the configured email exists but is not an admin, it throws rather
  than silently promoting a customer account to admin.

#### 3.4.5 `backend/middlewares/authMiddleware.js`

**Purpose.** Four guards, forming an ordered chain from "is this anyone at all?" up to
"is this a seller the admin has approved?".

```js
export const authenticate = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ code: "unauthenticated", message: "No token provided" });
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ code: "unauthenticated", message: "Invalid or expired token" });
  }
};

// Kept as an alias: every existing route file imports `verifyToken` by name.
export const verifyToken = authenticate;
export const isAuthenticated = authenticate;
```

- The `Authorization: Bearer <token>` header format is the HTTP standard for token auth.
  `.slice(7)` strips the seven characters of `"Bearer "`.
- `verifyAccessToken` throws on a bad signature *or* an expired token; both become a 401.
- On success it attaches `req.user`. **Every downstream handler reads identity from
  `req.user`, never from the request body.** That is the invariant that makes the whole
  authorization model work: a client cannot claim to be someone else, because the only place
  identity comes from is a cryptographically verified token.
- `verifyToken` and `isAuthenticated` are aliases. Three names for one function is
  historical debris, not design — the newest code says `authenticate`, older route files say
  `verifyToken`, and `orderRoute.js` uses both on different lines.

```js
export const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ code: "forbidden", message: "Admins only" });
  }
  next();
};

export const authorizeSeller = (req, res, next) => {
  if (req.user.role !== "seller") {
    return res.status(403).json({ code: "forbidden", message: "Sellers only" });
  }
  next();
};
```

> **401 vs 403 — the distinction beginners most often get wrong.**
> **401 Unauthorized** actually means *unauthenticated*: "I do not know who you are."
> **403 Forbidden** means *unauthorized*: "I know exactly who you are, and you may not do
> this." The difference is behavioural, not cosmetic: the frontend's axios interceptor
> retries after refreshing the token on a 401, because a fresh token might help. On a 403 it
> does not retry, because a new token for the same user changes nothing.

Note these read `req.user.role` — the role from the **JWT**, not from the database. That is
one database round-trip saved on every single request. The cost: if an admin demotes a user,
that user keeps admin powers until their current access token expires. With a 15-minute TTL
the exposure window is bounded at 15 minutes. §6.1 revisits this trade-off.

```js
export const checkSellerVerification = async (req, res, next) => {
  try {
    const seller = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!seller || seller.role !== "seller") {
      return res.status(403).json({ code: "forbidden", message: "Seller not found" });
    }

    if (!seller.isVerified) {
      return res.status(403).json({
        code: "forbidden",
        message: "Your account is pending admin verification. You cannot perform this action until approved.",
        sellerVerified: false,
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({ code: "internal_error", message: "Server error" });
  }
};
```

This one **does** hit the database, deliberately. `isVerified` is not in the JWT, and it
must not be stale: the moment an admin revokes verification, the seller must lose write
access. Reserving the DB read for the rare, high-stakes check while keeping the common role
check token-based is a deliberate and sensible split.

#### 3.4.6 `backend/middlewares/error.js`

```js
class ErrorHandler extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const errorMiddleware = (err, req, res, next) => {
  err.message = err.message || "Internal Server Error";
  err.statusCode = err.statusCode || 500;

  if (err.name === "CastError") {
    const message = `Resource not found. Invalid: ${err.path}`;
    err = new ErrorHandler(message, 400);
  }

  if (err.name === 'ValidationError') {
    const validationErrors = Object.values(error.errors).map(err => err.message);
    return next(new ErrorHandler(validationErrors.join(', '), 400));
  }

  return res.status(err.statusCode).json({ success: false, message: err.message });
};
```

**How Express recognises an error handler.** By **arity**: a middleware with four parameters
`(err, req, res, next)` is treated as an error handler, and Express skips it during normal
request flow.

**Three honest observations about this file:**

1. **Both special cases are Mongoose leftovers.** `CastError` and `ValidationError` are
   Mongoose error names. Prisma throws `PrismaClientKnownRequestError` with codes like
   `P2002` and `P2025`. Neither branch can fire any more.
2. **The `ValidationError` branch would crash if it did fire.** It references `error.errors`,
   but the parameter is named `err`. `error` is not defined in that scope, so this line would
   throw `ReferenceError: error is not defined`. It is unreachable dead code today; it is
   still a latent bug if anyone ever reuses that error name. See §8.5.
3. **Most routes never reach it.** Almost every controller wraps itself in try/catch and
   responds directly. And critically, in Express 4 an error thrown inside an `async` handler
   is **not** automatically forwarded to the error middleware — it becomes an unhandled
   promise rejection. So the per-controller try/catch is not redundancy, it is load-bearing.

### 3.5 File-by-file: routers and controllers

#### `backend/routes/authRoute.js` → `backend/controller/auth.js`

Routes:

| Method | Path | Guard | Handler |
|---|---|---|---|
| POST | `/register` | rate limit | `register` |
| POST | `/login` | rate limit | `login` |
| POST | `/refresh` | cookie only | `refresh` |
| POST | `/logout` | cookie only | `logout` |
| POST | `/google-signin` | none | `googleSignIn` |
| GET | `/getUser` | authenticate + authorizeAdmin | `getAllUsers` |
| GET | `/me` | authenticate | inline |
| PUT | `/profile` | authenticate | inline |
| PUT | `/update-password` | authenticate | `updatePassword` |
| GET | `/unverified-sellers` | authenticate + authorizeAdmin | `getUnverifiedSellers` |
| PUT | `/verify-seller/:sellerId` | authenticate + authorizeAdmin | `verifySeller` |
| PUT | `/reject-seller/:sellerId` | authenticate + authorizeAdmin | `rejectSeller` |

`auth.js` is the newest, most carefully written controller. Four helpers set its tone:

```js
const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v1/auth",
};

const issueSession = async (res, user) => {
  const refreshToken = await issueRefreshFamily(user.id);
  setRefreshCookie(res, refreshToken);
  return signAccessToken({ id: user.id, role: user.role });
};

const toPublicUser = (user) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  admin: user.role === "admin",
  seller: user.role === "seller",
  sellerVerified: user.role !== "seller" || user.isVerified,
});

const normalizeEmail = (email = "") => email.trim().toLowerCase();
```

- `issueSession` is the *only* place a session is created, used by `register`, `login`, and
  `googleSignIn`. One place to get the security right, three callers that cannot get it wrong.
- `toPublicUser` is an **allow-list projection**. It builds a brand-new object containing
  only safe fields, so the password hash, `googleId`, and internal verification timestamps
  physically cannot leak — even if someone later adds a sensitive column to `User`. Compare
  with the deny-list style used elsewhere in the same file:
  `const { password, ...userWithoutPassword } = user;` — that removes one known field and
  ships everything else, so a newly added secret column would leak by default. Allow-list is
  the safer discipline.
- Note the derived flag `sellerVerified: user.role !== "seller" || user.isVerified`. For a
  customer or admin this is `true` (the question does not apply); for a seller it is their
  real verification state. That single boolean lets the frontend gate seller UI without
  understanding roles.
- `normalizeEmail` is applied on every write and every lookup. Without it,
  `Alice@Example.com` and `alice@example.com` would be two accounts — and worse, a user who
  registered with one capitalisation could not log in with another.

The three seller-verification handlers are worth one note: `rejectSeller` records
`verificationRejectionReason` and emails the seller, but **does not set `isVerified: false`**
— it was already `false` since registration. So "rejected" and "not yet reviewed" are the
same state as far as the database is concerned, distinguishable only by whether a rejection
reason is present. A dedicated status column would model this better.

#### `backend/routes/productRoute.js` → `backend/controller/productController.js`

```js
// Public routes (no authentication required)
productRouter.get("/get", getProducts);
productRouter.get("/get/:id", getProductById);
productRouter.get("/search", searchProducts);
productRouter.post("/recommendations/retrain", verifyToken, authorizeAdmin, retrainProductRecommendations);
productRouter.get("/:productId/reviews", getProductReviews);
productRouter.get("/:productId/recommendations", getProductRecommendations);

// Protected routes (authentication required)
productRouter.post("/create", verifyToken, authorizeSeller, checkSellerVerification, createProduct);
productRouter.put("/update/:id", verifyToken, authorizeSeller, checkSellerVerification, updateProduct);
productRouter.delete("/delete/:id", verifyToken, authorizeSeller, checkSellerVerification, deleteProduct);
productRouter.post("/uploadImage", verifyToken, authorizeSeller, checkSellerVerification, upload.array("images", 3), uploadImage);
productRouter.post("/:productId/reviews", verifyToken, addProductReview);

// Seller-specific routes
productRouter.get("/seller/my-products", verifyToken, authorizeSeller, getSellerProducts);
productRouter.put("/seller/update/:id", verifyToken, authorizeSeller, checkSellerVerification, updateSellerProduct);
productRouter.delete("/seller/delete/:id", verifyToken, authorizeSeller, checkSellerVerification, deleteSellerProduct);
productRouter.put("/seller/discount/:productId", verifyToken, authorizeSeller, checkSellerVerification, setProductDiscount);
```

**Reads are public; writes require an approved seller.** That is exactly right for a
storefront — a visitor must be able to browse without an account.

**Route ordering subtlety.** `/get/:id` is declared before `/:productId/reviews`. Express
matches in declaration order. If a route `/:productId` had been declared first, it would
swallow `/search` and `/get` as if they were product ids. The literal-paths-first ordering
here is load-bearing.

**The comment block is slightly misleading**: `POST /recommendations/retrain` sits under the
"Public routes" heading but carries `verifyToken, authorizeAdmin`. It is admin-only; the
heading is just stale.

Two functions in this controller deserve separate attention:

**`buildProductUpdateData(body)`** — replaces what used to be a raw
`findByIdAndUpdate(id, req.body)` pass-through. It copies only known fields, and for the
variant tables it does a delete-then-recreate:

```js
if (body.colorVariants !== undefined) {
  data.colorVariants = {
    deleteMany: {},
    create: (body.colorVariants || []).map((cv) => ({
      color: cv.color, images: cv.images || [], stock: cv.stock || 0,
    })),
  };
}
```

**Why this matters for security.** The old pass-through was a **mass-assignment
vulnerability**: a seller could `PUT {"sellerId": "<someone-else>"}` and hand their product
to another account, or `PUT {"discount": 100}` outside the discount endpoint's validation.
An explicit allow-list closes that. **Why delete-then-recreate:** under MongoDB these were
embedded arrays that got replaced wholesale; the nested write reproduces that exact semantic
on a relational schema.

**`retrainProductRecommendations`** — shells out to Python:

```js
const { stdout, stderr } = await execFileAsync(pythonCommand, [scriptPath, "--input", datasetPath, ...],
  { cwd: recommendationDir, maxBuffer: 1024 * 1024 * 10 });
```

Note it uses `execFile`, not `exec`. **`exec` runs a command string through a shell**, so
any argument containing `;` or `` ` `` could inject another command. **`execFile` passes an
argument array directly to the process, no shell involved** — so shell injection is
structurally impossible. Every numeric parameter is additionally clamped
(`minSupport` to `(0,1]`, `topK` to `[1,20]`) before being stringified. This is the right
way to call an external program from a web server. See §8.6 for the filename bug that
nonetheless makes this endpoint fail today.

#### `backend/routes/orderRoute.js` → `backend/controller/order.js`

The biggest surface in the app. Grouped:

| Group | Routes |
|---|---|
| Read | `GET /getOrder` (all), `GET /user/get` (mine), `GET /details/:orderId`, `GET /user/debug/info` |
| Create | `POST /createOrder`, `POST /createBulkOrder` |
| Modify | `PUT /updateOrder/:id`, `DELETE /deleteOrder/:id`, `PUT /user/update/:id`, `DELETE /user/delete/:id` |
| Seller | `GET /seller/my-orders`, `PUT /seller/update-status/:orderId` |
| Billing | `GET /bill/:orderId`, `GET /user/bills`, `POST /send-confirmation/:orderId` |
| Lifecycle | `PUT /confirm/:orderId`, `PUT /cancel/:orderId`, `PUT /return/:orderId`, `PUT /admin/return/:orderId`, `PUT /seller/return/:orderId`, `PUT /admin/refund/:orderId` |
| Tracking | `GET /track/:orderId` |

**Authorization gap worth flagging.** `GET /getOrder` — which returns **every order in the
system** — is guarded only by `verifyToken`. There is no `authorizeAdmin`. Any logged-in
customer who calls it receives every other customer's name, email, delivery address, and
order total. `PUT /updateOrder/:id` and `DELETE /deleteOrder/:id` are likewise
authenticate-only with no ownership check inside the handler. Contrast with
`cancelOrder`/`trackOrder`/`requestReturn`, which all check
`if (order.userId !== userId) return res.status(403)`. This is covered as a finding in §8.9.

Two utility exports from this file are used by other modules and by tests:

```js
export const adjustStock = async (productId, quantity, selectedColor, selectedStorage, sign, client = prisma) => {
  const productDetails = await client.product.findUnique({
    where: { id: productId },
    include: { colorVariants: true, storageVariants: true },
  });
  if (!productDetails) return null;

  const delta = sign * quantity;
  await client.product.update({ where: { id: productId }, data: { quantity: { increment: delta } } });

  if (selectedColor && productDetails.colorVariants.length > 0) {
    await client.productColorVariant.updateMany({
      where: { productId, color: selectedColor },
      data: { stock: { increment: delta } },
    });
  }
  if (selectedStorage && productDetails.storageVariants.length > 0) {
    await client.productStorageVariant.updateMany({
      where: { productId, storage: selectedStorage },
      data: { stock: { increment: delta } },
    });
  }

  return client.product.findUnique({ where: { id: productId } });
};
```

- **One function, both directions.** `sign = -1` deducts (order confirmed), `sign = +1`
  restores (cancelled, returned). One function means the two paths cannot drift apart.
- **`{ increment: delta }` instead of read-then-write.** This compiles to SQL
  `SET quantity = quantity + $1`, computed **inside the database**. A read-modify-write in
  JavaScript would be a classic **lost update**: two concurrent orders both read 10, both
  write 9, and one sale vanishes. Letting the database do the arithmetic makes it atomic.
- **`client = prisma`.** The injection point for both `$transaction` handles and test fakes.

```js
export const updateFirstRevenueByOrder = async (orderId, data, client = prisma) => {
  const revenue = await client.revenue.findFirst({ where: { orderId } });
  if (!revenue) return null;
  return client.revenue.update({ where: { id: revenue.id }, data });
};
```

The comment explains it exactly mirrors Mongoose's `findOneAndUpdate({ orderId }, data)`,
because there is no unique constraint on `Revenue.orderId` in the new schema either. The
test asserts the second matching row is left untouched — preserving a quirk deliberately,
rather than silently changing behaviour during a database migration. That is good migration
discipline; it is also a schema smell worth fixing later.

#### `backend/routes/paymentRoute.js` → `backend/controller/payment.js`

```js
paymentRouter.post("/checkout", verifyToken, checkout);

// eSewa redirects the browser here after payment — gateway-initiated, no auth header to check.
paymentRouter.get("/esewa/success/:orderId", esewaSuccessWebhook);
paymentRouter.get("/esewa/failure/:orderId", esewaFailureWebhook);
```

Three routes, and the asymmetry is the whole story: `/checkout` is authenticated because a
logged-in customer initiates it; the two callbacks **cannot** be, because the request comes
from eSewa's redirect and carries no `Authorization` header. §4.12 and §5.4 explain in full
how they are secured instead.

#### `backend/routes/cartRoute.js` → `backend/controller/cartController.js`

All five routes require `verifyToken`. The controller has one notable characteristic: it
looks carts up **by email**, not by user id.

```js
const getCartWithItems = (email) =>
  prisma.cart.findFirst({
    where: { email },
    include: { items: { include: { product: { select: PRODUCT_SELECT } } } },
  });
```

Every handler starts by loading the user from `req.user.id` and then querying by
`user.email`. This is Mongo-era modelling carried over: `Cart` has both a `userId` foreign
key and a duplicated `email` column, and the lookups use the denormalised copy. It works
(email is unique on `User`), but it means changing a user's email orphans their cart, and it
uses `findFirst` on a non-unique column where `findUnique` on `userId` would be both faster
and stricter.

The controller also owns the **discount math**:

```js
const withDiscount = (items) => {
  let totalPrice = 0;
  let totalDiscount = 0;

  const itemsWithDiscount = items.map((item) => {
    const discount = item.product.discount || 0;
    const originalPrice = item.price * item.quantity;
    const discountAmount = (originalPrice * discount) / 100;
    const finalPrice = originalPrice - discountAmount;

    totalPrice += originalPrice;
    totalDiscount += discountAmount;

    return { ...item, discount,
      discountedPrice: discount > 0 ? item.price * (1 - discount / 100) : item.price,
      itemTotal: originalPrice, itemDiscount: discountAmount, itemFinal: finalPrice };
  });

  return { itemsWithDiscount, totalPrice, totalDiscount, finalPrice: totalPrice - totalDiscount };
};
```

Note `item.price` is the price **captured when the item was added to the cart**
(`price: product.price` in `addToCart`), while `item.product.discount` is read **live**. So a
price rise after you add to cart does not affect you, but a new discount does. That is a
customer-friendly asymmetry — and it is a policy decision hiding in two lines of code, not
an accident, though nothing documents it as such.

**A real inconsistency inside this file:** `addToCart` recomputes and persists `totalPrice`
via `withDiscount(...)`, but `updateCartItem`, `removeFromCart`, and `clearCart` each
recompute it with a plain, discount-free sum:

```js
const totalPrice = populatedCart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
```

So the persisted `carts.totalPrice` column means different things depending on which endpoint
last touched it. In practice nothing depends on the stored value — every read path calls
`withDiscount` and returns freshly computed figures — but the stored column is unreliable and
should either be made consistent or dropped.

#### `backend/routes/promoCodeRoute.js` → `backend/controller/promoCodeController.js`

Admin routes create/list/toggle/delete/notify/reset; user routes validate and apply.
The important split is `validatePromoCode` (a **dry run** that computes and returns the
discount without consuming anything) versus `applyPromoCode` (which **records consumption**).
§4.14 covers why that split exists and where it leaks.

#### `backend/routes/revenueRoute.js` → `backend/controller/revenueController.js`

Two admin endpoints, two seller endpoints, plus `POST /create`.

**Note:** `revenueRouter.post("/create", verifyToken, createRevenueRecord)` sits under an
`// Admin routes` comment but carries **no** `authorizeAdmin`. Any authenticated user can
POST an `orderId` and mint an extra `Revenue` row for it — inflating a seller's reported
earnings and the platform's reported commission. In practice revenue rows are created
automatically inside `createOrder`/`createBulkOrderFromCart`, so this endpoint appears to be
vestigial; it is still reachable. Listed in §8.9.

All four reporting endpoints follow the same shape: fetch matching rows, then `reduce` them
in JavaScript.

```js
const totalSalePrice = revenues.reduce((sum, r) => sum + r.totalSalePrice, 0);
const totalAdminCommission = revenues.reduce((sum, r) => sum + r.adminCommission, 0);
const totalSellerRevenue = revenues.reduce((sum, r) => sum + r.sellerRevenue, 0);
```

**Trade-off, stated plainly.** Summing in application code means every matching row travels
over the network into Node's memory. For a few thousand rows that is fine and the code is
very easy to read. At a million rows it is not: the right form is
`prisma.revenue.aggregate({ _sum: { ... } })` or a `GROUP BY`, which sums inside Postgres and
returns a handful of numbers. The schema is already prepared for this — the indexes
`@@index([sellerId, year, month])` and `@@index([adminId, year, month])` exist precisely to
make those aggregate queries fast. So the plan is visible in the schema even though the
queries have not caught up. See §6.9.

#### `backend/routes/notificationRoute.js` → `backend/controller/notificationController.js`

The smallest controller (79 lines), and a good model of ownership-safe queries:

```js
export const markAsRead = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { count } = await prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });

  if (count === 0) return res.status(404).json({ message: "Notification not found" });
  ...
};
```

`updateMany` with **both** `id` and `userId` in the `where` clause means a user cannot mark
someone else's notification read — not because of an `if` statement that could be forgotten,
but because the SQL simply matches zero rows. The `count === 0` check then covers both "does
not exist" and "not yours" with the same 404, which also avoids leaking whether that
notification id exists at all.

#### `backend/routes/userManagementRoute.js` → `backend/controller/userManagement.js`

```js
userManagementRouter.use(verifyToken, authorizeAdmin);
```

**Router-level `use`.** Instead of repeating guards on six routes, they are applied once to
the whole router. Every route below inherits both. This is strictly safer than per-route
repetition: adding a seventh route cannot accidentally omit the guard.

Note the import: `import { authorizeAdmin } from "../controller/auth.js"` — but `auth.js`
merely re-exports it (`export { authorizeAdmin } from "../middlewares/authMiddleware.js";`),
so it is the same function.

#### `backend/routes/chatRoute.js`

Self-contained: loads FAQs and the recommendation map at module load, then on each request
fetches up to 60 live products, builds a system prompt, and calls Groq.

```js
const products = await prisma.product.findMany({
  take: 60,
  select: { name: true, price: true, category: true, quantity: true,
            colorVariants: true, storageVariants: true },
});
```

> **Jargon: system prompt.** Instructions given to a language model before the user's
> message, defining its role and rules. It is not shown to the user.

> **Jargon: grounding.** Injecting real, current data into the prompt so the model answers
> from facts instead of inventing them. That is what `productContext` does here — the model
> is told the live catalogue with live stock numbers, so it cannot hallucinate a price.

The prompt contains defensive instructions that read like scar tissue from real testing:

```
- CRITICAL: The prices listed in the store are the OFFICIAL ShopSphere prices. Never question,
  correct, compare, or comment on any product's price...
- CRITICAL: When asked about stock or availability, always state the exact quantity number...
- CRITICAL: Never mention or suggest a color, storage, or variant that is marked OUT OF STOCK.
```

The first exists because a model trained on world data "knows" an iPhone costs more than the
demo price and would helpfully point that out to customers.

Conversation history is capped and the first message dropped:

```js
const chatHistory = history.filter((_, i) => i > 0).slice(-10).map(h => ({
  role: h.role === "bot" ? "assistant" : "user",
  content: h.content,
}));
```

`i > 0` drops the client-side greeting (the model did not say it); `slice(-10)` caps context
size, which caps both cost and latency.

Rate limiting from the provider is handled gracefully:

```js
if (error?.status === 429) {
  return res.status(200).json({ reply: "I'm a little busy right now! Please try again in a moment. 🙏" });
}
```

Returning **200 with a friendly message** rather than 429 is a deliberate UX choice: the
widget shows a chat bubble instead of an error state.

**Security note:** `/api/v1/chat` has **no authentication and no rate limiting**. Anyone who
can reach the API can spend the project's Groq quota. `express-rate-limit` is already a
dependency; applying it here would be a two-line fix.

#### `backend/routes/testEmailRoute.js`

A diagnostic endpoint that sends a test email. **Unauthenticated**, and it logs
`EMAIL_PASS length` to the server console. It is a development tool that is currently
mounted in every environment. It should be removed, or gated behind
`verifyToken + authorizeAdmin`, before any real deployment.

### 3.6 File-by-file: the frontend

#### `frontend/index.html`

The single HTML page. Everything else is injected by JavaScript.

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0,
      user-scalable=no, viewport-fit=cover" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
...
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

`<div id="root">` is the mount point. `user-scalable=no` disables pinch-zoom — common in
app-like builds, but it is an accessibility regression for users who need to zoom.
`viewport-fit=cover` plus the `env(safe-area-inset-*)` variables in `index.css` handle
notched phone screens.

#### `frontend/src/main.tsx`

```tsx
import './lib/session'; // installs the axios auth interceptors before any request fires

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>
);
```

The bare `import './lib/session'` imports the module purely for its **side effects** —
registering the axios interceptors. It must happen before any component can fire a request,
which is why it sits in the entry file rather than inside a component.

`<StrictMode>` is a development-only wrapper that deliberately runs effects **twice** to
surface bugs caused by non-idempotent effects. That double-invocation is why
`frontend/src/pages/Success.tsx` guards with a ref:

```tsx
const updateOrderCalledRef = useRef(false);

const updateOrder = async () => {
    // Prevent duplicate calls (handles React StrictMode and accidental double-triggers)
    if (updateOrderCalledRef.current) return;
    updateOrderCalledRef.current = true;
    ...
```

A `useRef` value persists across re-renders and, unlike state, changing it does not trigger a
re-render — exactly right for a "have I already done this?" flag.

#### `frontend/src/App.tsx`

Three responsibilities: provide Google OAuth context, declare all routes, and run two
app-wide effects.

```tsx
useEffect(() => {
  // Access tokens live in memory only, so a hard reload starts with none —
  // this trades the refresh cookie for a fresh one if the session is still valid.
  if (localStorage.getItem('token')) refreshSession();
}, []);
```

This is the bridge between page loads. Memory is wiped on reload; the httpOnly cookie is not.
The `localStorage` check is a cheap "was this browser ever logged in?" hint that avoids an
unnecessary network call for first-time visitors. §4.7 explains why that stored value is a
sentinel and not a credential.

The second effect handles the mobile on-screen keyboard, using `window.visualViewport` to
scroll a focused input above the keyboard. It fires at 50/250/500/800 ms after focus to
catch any stage of the keyboard animation — pragmatic, if inelegant.

#### `frontend/src/lib/session.ts`

Already covered in §2.13 for interceptors; the state model is the other half.

```ts
// The real bearer access token lives ONLY here (module memory) — never localStorage,
// per the backend's token model.
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

axios.defaults.withCredentials = true; // send the httpOnly refresh cookie
```

`axios.defaults.withCredentials = true` is essential: by default the browser does **not**
send cookies on cross-origin requests, and the frontend (`:5173`) and backend (`:4000`) are
different origins. This is the client-side half of the pair whose server-side half is
`credentials: true` in the CORS config. Both are required; either alone does nothing.

#### `frontend/src/lib/utils.ts`

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getImageUrl(url: string | undefined | null): string {
  if (!url) return '/default-product.jpg';
  const base = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000/api').replace('/api', '');
  return url.replace(/^http:\/\/localhost:\d+/, base);
}
```

`cn` merges class names and resolves Tailwind conflicts — `cn('p-2', 'p-4')` yields `p-4`
rather than both.

`getImageUrl` exists because `uploadImage` in the backend stores **absolute** URLs built from
the request host:

```js
// backend/controller/productController.js
const imageUrls = req.files.map((file) =>
  `${req.protocol}://${req.get("host")}/uploads/${file.filename}`);
```

Upload from a laptop and every image URL is permanently baked as
`http://localhost:4000/uploads/...` — unreachable from a phone or from production.
`getImageUrl` rewrites the host at render time. **This is a workaround for a modelling
mistake.** The clean fix is to store the relative path (`/uploads/abc.jpg`) and let the
client prepend its configured base; then no rewriting is needed anywhere.

#### Selected frontend components

**`components/catalog/ProductCard.tsx`** — one product tile. Encodes three inventory states
in *text*, not just colour:

```tsx
<p className={`mt-2 text-xs font-medium ${soldOut ? 'text-seal'
    : product.quantity <= 5 ? 'text-accent-dark' : 'text-ink-muted'}`}>
  {soldOut ? 'Currently unavailable' : product.quantity <= 5 ? `Only ${product.quantity} left` : 'In stock'}
</p>
```

Colour alone would be invisible to a colour-blind user and to a screen reader. The
accompanying test asserts on the text, locking that property in.

The `canPurchase` prop decides whether a guest sees one "View" button or a logged-in
customer sees "Add to cart" / "Buy now" — an authorization-shaped decision expressed as a
prop, letting the same component serve both audiences.

**`components/checkout/CartSummary.tsx`** — a pure presentational component: it takes
`itemCount`, `subtotal`, and an `onCheckout` callback, and holds no state. Easy to test,
impossible to break by changing the API.

**`components/NotificationBell.tsx`** — polls every 30 seconds.

> **Jargon: polling.** Asking the server "anything new?" on a timer. Simple, works
> everywhere, but wastes requests when nothing changed and adds up to 30 s of latency. The
> alternatives are **WebSockets** (a persistent two-way connection) or **Server-Sent Events**
> (a one-way stream), both of which push instantly but need connection management and complicate
> horizontal scaling. For low-stakes notifications, 30-second polling is a perfectly
> defensible choice.

**`components/ChatWidget.tsx`** — a floating chat panel. Keeps message history in component
state and sends the last messages with each request, since the backend is stateless.

#### `frontend/src/pages/` — the 45 route components

Grouped by audience:

**Public / customer:** `Home`, `AllProducts`, `ProductDetailsPage` (1,227 lines — the
largest frontend file), `Cart`, `BuyProduct` (single-item checkout), `CartCheckout`
(multi-item checkout), `Success`, `Failure`, `MyOrders`, `MyOrdersNew`, `OrderDetails`,
`TrackOrder`, `UserBillHistory`, `Profile`, `UserDetails`.

**Auth:** `AuthLanding`, `Auth`, `UserAuth`, `AdminAuth`.

**Seller:** `SellerPanel`, `SellerProducts`, `SellerProductDetails`, `SellerOrders`,
`SellerRevenueDashboard`, `AddProduct`.

**Admin:** `AdminPanel`, `AdminOrders`, `AdminUserManagement`, `AdminSellerApproval`,
`AdminRevenueDashboard`, `PromoManagement`, `ProductDetailsAdmin`.

**Legacy / orphaned:** `PaymentForm` (route `/payment` exists; **nothing navigates to it** —
see §8.3), and duplicate pairs like `MyOrders`/`MyOrdersNew` where both are still routed.

**A general observation about the pages.** There is **no global state management** — no
Redux, no Zustand, no React Context for data. Every page fetches what it needs, into its own
`useState`, on mount. The cost is duplication (many pages independently fetch the product
list) and no shared cache (navigating away and back re-fetches). The benefit is that every
page is independently understandable with no hidden global state. Adding React Query or SWR
would give caching and deduplication with a small API surface, and is the natural next step
if data-fetching duplication becomes a maintenance problem.
---

## 4. Core Concepts Explained from Zero

Each concept below follows the same four-step shape: **what it is** in plain English,
**why ShopSphere needs it**, **how it is implemented here**, and **how the pieces interact**.

### 4.1 Client and server, and why they are separate programs

**The concept.** A **client** is the program the user interacts with — here, the React app
running in their browser. A **server** is a program running on a machine you control that
the client talks to over the network.

**Why they must be separate.** Because **the client cannot be trusted.** Anything running in
the user's browser can be read, modified, or bypassed. A user can open developer tools, edit
the JavaScript, and send whatever request they like. They can skip the browser entirely and
use `curl`.

That single fact drives half the architecture of this application:

- Prices are recomputed on the server (`totalPrice = quantity * productDetails.price` in
  `createOrder`) rather than accepted from the client.
- The payment amount is recomputed from the database in `checkout`, never taken from the
  request body.
- Stock is checked on the server before an order is created and again before it is confirmed.
- The user's identity comes from a signed token, not from a `userId` field in the body.
- The eSewa signing secret lives only on the server.

> **The one-sentence rule to remember:** *the client is a convenience, the server is the
> authority.* Every check the client does is for user experience (fast feedback); every
> check that matters is repeated on the server.

You can see both halves in this repo. `frontend/src/pages/CartCheckout.tsx` validates the
delivery form before submitting:

```tsx
if (!userDetails.phone || !userDetails.street || !userDetails.city || ...) {
  toast.error("Please fill complete delivery address");
  return;
}
```

That is the convenience half. The authority half is `createBulkOrderSchema` in
`backend/controller/order.js`, which rejects a malformed body regardless of what the browser
did or did not check.

### 4.2 Identifiers: why every id is exactly 24 hexadecimal characters

**The concept.** Every row in a database needs a unique identifier. Common choices are an
auto-incrementing integer (1, 2, 3…), a UUID (`550e8400-e29b-41d4-a716-446655440000`), or
something custom.

**What ShopSphere does.** `backend/utils/generateId.js`, in its entirety:

```js
import { randomBytes } from "crypto";

// 24 hex chars, same shape as the MongoDB ObjectIds this app used to generate —
// keeps every id column's VarChar(24) valid for both migrated and new rows.
export const generateId = () => randomBytes(12).toString("hex");
```

12 random bytes rendered as hexadecimal gives 24 characters, e.g.
`66a200000000000000000003`.

**Why this exact shape.** MongoDB's native id type is the **ObjectId**: 12 bytes, usually
written as 24 hex characters. When this project migrated from MongoDB to PostgreSQL, every
existing document already had such an id — and those ids were baked into JWTs already issued
to users, and cached in browsers. The migration script copies each Mongo `_id` verbatim into
the Postgres primary key. Newly created rows must therefore look the same, or the
`@db.VarChar(24)` column type would reject them.

The schema states this in a comment at the top:

```prisma
// All ids are the original MongoDB ObjectId hex strings (24 chars), carried
// over as-is during migration so existing JWTs and client-cached ids keep working.
```

**Why not auto-incrementing integers?** Two reasons. First, they leak business information —
if your order id is 4,417, a competitor knows you have had roughly 4,417 orders, and can
watch the number climb. Second, they are guessable: a user with order 4,417 can try 4,416.
That is fine when every endpoint checks ownership, and a disaster on any endpoint that
forgets. A random id is not enumerable.

**Why not UUIDs?** They would have been the natural choice for a fresh project. Here, the
constraint of not breaking existing tokens and ids won.

**Note the inconsistency.** Not every model uses `generateId()`. Look carefully:

```prisma
model ProductColorVariant {
  id        String  @id @default(cuid())
  ...
}
model CartItem {
  id        String   @id @default(cuid())
  ...
}
model ProductReview {
  id        String   @id @default(cuid())
  ...
}
```

These three use **cuid**, generated by Prisma itself, not the 24-hex scheme. The reason is
historical: under MongoDB these were **embedded documents** inside their parent — a colour
variant lived *inside* the product document and had no independent id that any client could
have cached. When they became real tables, they needed ids, but there was no legacy shape to
preserve, so Prisma's default was fine.

**The lesson.** Id strategy is not cosmetic. Changing it later is one of the most invasive
migrations possible, because ids travel outward into tokens, URLs, caches, and third-party
systems. Decide early.

### 4.3 The product catalogue, and the variant problem

**The concept.** A catalogue is the set of things you sell. The complication in real retail
is that "iPhone 17 Pro" is not one sellable thing — it is many. Black 256 GB is a different
physical item, with different stock, from Blue 512 GB.

The industry vocabulary here is worth learning:

> **Product** — the marketing-level thing customers browse and search for ("iPhone 17 Pro").
>
> **Variant / SKU** — the individually stockable, individually shippable thing
> ("iPhone 17 Pro, Black, 256 GB"). SKU = Stock Keeping Unit. This is what a warehouse
> actually counts.

**How ShopSphere models it.** Somewhat unusually: there are **three parallel representations**
of variants, and understanding why is understanding the migration.

**Representation 1 — string arrays on the product** (the "what options exist" list):

```prisma
model Product {
  variantStorage    String[]  @default([])
  variantColor      String[]  @default([])
  variantRam        String[]  @default([])
  variantScreenSize String[]  @default([])
  variantProcessor  String[]  @default([])
}
```

> **Jargon: `String[]`.** PostgreSQL natively supports array-typed columns — a single cell
> holding `{"128GB","256GB","512GB"}`. Most relational databases do not. It is a
> denormalisation: convenient to read, but you cannot put a foreign key or an index on an
> individual element.

These arrays are the dropdown options shown on the product page. **They carry no stock.**

**Representation 2 — child tables with real stock:**

```prisma
model ProductColorVariant {
  id        String   @id @default(cuid())
  productId String   @db.VarChar(24)
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  color     String?
  images    String[] @default([])
  stock     Int      @default(0)

  @@index([productId, color])
  @@map("product_color_variants")
}

model ProductStorageVariant {
  id        String  @id @default(cuid())
  productId String  @db.VarChar(24)
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  storage   String?
  stock     Int     @default(0)

  @@index([productId, storage])
  @@map("product_storage_variants")
}
```

These are where per-variant stock actually lives. `onDelete: Cascade` means deleting a
product automatically deletes its variant rows — the database enforces the cleanup, so no
orphan rows can survive an application bug.

**Representation 3 — a base `quantity` on the product itself:**

```prisma
model Product {
  quantity          Int
}
```

**The critical architectural consequence: colour and storage stock are tracked
independently, not as a combination.** There is no table of
"(Black, 256 GB) → 4 units". There is "Black → 4" and "256 GB → 7" and "product → 18",
as three separate numbers.

Availability is therefore computed as the **minimum** of whichever apply
(`backend/controller/order.js`, `createOrder`):

```js
let availableStock = productDetails.quantity;

if (selectedColor && productDetails.colorVariants && productDetails.colorVariants.length > 0) {
  const colorVariant = productDetails.colorVariants.find(cv => cv.color === selectedColor);
  if (!colorVariant) {
    return res.status(400).json({ message: "Selected color not found" });
  }
  availableStock = Math.min(availableStock, colorVariant.stock);
}

if (selectedStorage && productDetails.storageVariants && productDetails.storageVariants.length > 0) {
  const storageVariant = productDetails.storageVariants.find(sv => sv.storage === selectedStorage);
  if (!storageVariant) {
    return res.status(400).json({ message: "Selected storage not found" });
  }
  availableStock = Math.min(availableStock, storageVariant.stock);
}

if (availableStock <= 0) {
  return res.status(400).json({ message: "Product out of stock" });
}
if (quantity > availableStock) {
  return res.status(400).json({ message: `Only ${availableStock} units available` });
}
```

And deduction updates all three counters (`adjustStock`, §3.5).

**What this means in practice.** Suppose Black has 4 units and 256 GB has 7 units. The system
will happily sell 4 units of "Black 256 GB". If in reality you only ever had 2 Black 256 GB
units (the other 2 Black were 128 GB), you have oversold. The model cannot express that,
because it never stores the combination.

**Why it is like this.** Almost certainly because the MongoDB documents had embedded
`colorVariants` and `storageVariants` arrays, and the migration preserved the structure
rather than redesigning it mid-flight. That was the right call for a migration — change one
thing at a time — but it leaves a known modelling limit.

**What a full solution looks like** (clearly labelled as *not* what this repo does): a single
`ProductVariant` table with one row per real combination:

```
ProductVariant
  id | productId | color | storage | ram | sku | stock | priceOverride
```

Then stock is one number on one row, oversell is impossible, and per-combination pricing
becomes possible ("512 GB costs Rs. 20,000 more"). The cost is a bigger migration and more
complex product-creation UI.

### 4.4 Confusable pair: "stock" vs "inventory"

These get used interchangeably in conversation, and the code uses both.

- **Stock** is a *number*: how many units of one specific thing you can sell right now.
  `product.quantity`, `colorVariant.stock`.
- **Inventory** is the *system* of tracking stock: the counts, plus the movements
  (received, reserved, sold, returned, damaged), plus the audit trail of who changed what.

ShopSphere tracks **stock**. It does not have an inventory system: there is no record of
*why* a count changed, no reservation concept, no stock-movement ledger. The closest thing is
that order status changes imply stock changes, so you can reconstruct history by reading the
`Order` table.

Interesting contrast within the same codebase: **payments do have an event ledger**
(`PaymentEvent`, append-only, immutable). Stock does not. That tells you where the project
judged the risk to be highest — and it is a reasonable prioritisation, since a stock
discrepancy is a customer-service problem while a payment discrepancy is a legal one.

### 4.5 The shopping cart

**The concept.** A holding area for items a customer intends to buy, before they commit.

**Why a cart is not just a list.** It must survive: closing the tab, switching from phone to
laptop, and logging out and back in. That means it must live on the server, not in browser
memory.

> **Client-side vs server-side carts.** A client-side cart lives in `localStorage`. It needs
> no account and no server round-trips, but it dies with the browser and cannot follow the
> user across devices. A server-side cart is a database row: it persists and syncs, but
> requires the user to be logged in. ShopSphere uses a **server-side cart** —
> `cartRoute.js` requires `verifyToken` on all five routes, so you must be logged in to have
> a cart at all.

**The schema:**

```prisma
model Cart {
  id         String   @id @db.VarChar(24)
  userId     String   @db.VarChar(24)
  user       User     @relation(fields: [userId], references: [id])
  email      String
  totalPrice Float    @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @default(now())

  items CartItem[]

  @@map("carts")
}

model CartItem {
  id        String   @id @default(cuid())
  cartId    String   @db.VarChar(24)
  cart      Cart     @relation(fields: [cartId], references: [id], onDelete: Cascade)
  productId String   @db.VarChar(24)
  product   Product  @relation(fields: [productId], references: [id])
  quantity  Int      @default(1)
  price     Float
  variants  Json     @default("{}")
  addedAt   DateTime @default(now())

  @@map("cart_items")
}
```

**Why `CartItem.price` exists at all** — this is the interesting design question. The price
is already on the `Product` row; storing a second copy is duplication. It is stored because
it is a **price snapshot**: the price *at the moment this item was added*. Without it, a
seller raising the price would silently change what is in every customer's cart.

**Why `variants` is a `Json` column.** The set of variant dimensions differs by product
category — a phone has colour and storage, a laptop has RAM and processor, a cable has
neither. A JSON column absorbs that variability without a column per dimension. The
trade-off: the database cannot validate or index its contents.

That trade-off has a visible consequence in `addToCart`:

```js
const existingItem = cart.items.find(
  (item) =>
    item.productId === productId &&
    JSON.stringify(item.variants) === JSON.stringify(variants || {})
);
```

Deciding "is this the same cart line?" requires comparing the JSON **as a string**. That is
fragile: `{"color":"Black","storage":"256GB"}` and `{"storage":"256GB","color":"Black"}`
describe the same variant but produce different strings, so you would get two cart lines.
In practice the frontend always builds the object in the same key order, so it works — but
it works by convention, not by construction.

**Cart lifecycle in this codebase:**

1. `addToCart` creates the cart on first use (`prisma.cart.create` with a nested item
   `create`), or adds/increments an item.
2. `getCart` returns the cart, computing discounts live.
3. `updateCartItem` changes a quantity; `quantity <= 0` is treated as "remove". The zod
   schema explicitly permits this, with a comment: `// <= 0 is a valid "remove item" signal`.
4. `removeFromCart` / `clearCart` delete items.
5. **The cart is cleared automatically after a successful order** — inside `confirmOrderCore`,
   not in `cartController.js`:

```js
// backend/controller/order.js, end of confirmOrderCore
try {
  const userEmail = primaryOrder.email;
  const cart = await prisma.cart.findFirst({ where: { email: userEmail }, include: { items: true } });
  if (cart && cart.items.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { totalPrice: 0, updatedAt: new Date() } });
    console.log(`✅ Cart cleared for user: ${userEmail}`);
  }
} catch (cartError) {
  console.error("Error clearing cart:", cartError);
  // Don't fail the order if cart clearing fails
}
```

Note **when** it clears: at *confirmation* (after payment succeeded), not at order creation.
If a customer abandons payment, their cart is still there when they come back. That is
correct behaviour and it is a direct consequence of the deferred-stock design in §4.9.

Note also the `try/catch` that swallows the error. This is a pattern used deliberately
throughout `order.js`: **non-essential side effects must never fail the essential operation.**
The order is confirmed and paid; a failure to tidy the cart is an annoyance, not a reason to
error out a completed purchase.

### 4.6 Authentication: sessions, access tokens, and refresh tokens

**The problem.** HTTP is **stateless** — each request arrives with no memory of any previous
one. So after a user logs in, every subsequent request must prove who they are, all over again.

**Option A: server-side sessions.** On login the server generates a random session id, stores
`sessionId → userId` in its own memory or in Redis, and sets it as a cookie. Each request
carries the cookie; the server looks it up.

- Advantage: **instant revocation.** Delete the row, the session is dead immediately.
- Disadvantage: the server must store state for every logged-in user, and every request costs
  a lookup. With multiple server instances, that store must be shared (Redis), which is
  another moving part.

**Option B: stateless tokens (JWT).** On login the server hands back a signed token
containing the user id and role. It stores nothing. Each request carries the token; the server
verifies the signature and reads the claims.

- Advantage: no server-side storage, no lookup, trivially horizontally scalable.
- Disadvantage: **you cannot revoke it.** The token is valid until it expires, because
  validity is a mathematical property of the signature, not a database lookup.

**ShopSphere uses a hybrid, and the hybrid is the interesting part.**

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (readable, self-describing) | Opaque random bytes (meaningless string) |
| Lifetime | 15 minutes | 7 days |
| Stored server-side? | No | Yes — as a SHA-256 hash |
| Sent how? | `Authorization: Bearer …` header | httpOnly cookie |
| Kept where in the browser? | JavaScript memory only | Cookie, unreadable by JavaScript |
| Used for | Every API call | Only `/api/v1/auth/refresh` and `/logout` |
| Revocable? | No (expires in ≤15 min) | Yes, immediately |

The design reasoning: **the frequently-used credential is the one you cannot revoke, so make
it expire fast; the revocable credential is the one you rarely use, so a database lookup on it
is cheap.**

**The access token** (`backend/utils/tokens.js`):

```js
const ACCESS_TOKEN_TTL = "15m";

export const signAccessToken = ({ id, role }) =>
  jwt.sign({ sub: id, role, jti: randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
```

**The refresh token** — and note the comment, which explains a real design decision:

```js
// Opaque, not a JWT: refresh tokens are only ever looked up by hash, never decoded.
export const generateRefreshToken = () => randomBytes(32).toString("base64url");

export const hashRefreshToken = (token) => createHash("sha256").update(token).digest("hex");
```

**Why opaque instead of a JWT?** A JWT carries readable claims, which is useful only if you
plan to read them without a database lookup. But every refresh **must** hit the database
anyway, to check rotation state. So the claims would be pure overhead — and worse, they would
leak information (`sub`, `role`) to anyone who intercepted the token.

**Why store only the hash?** Because a refresh token is a **bearer credential** — whoever
holds it can use it. If the database is leaked and it contains raw refresh tokens, the
attacker has working sessions for every user. Storing only SHA-256 hashes means the leaked
data is useless: you cannot reverse a hash. At refresh time the server hashes what was
presented and looks up by that hash.

> **Why SHA-256 is fine here but wrong for passwords.** A password is short and
> human-chosen, so it can be brute-forced from its hash — hence the deliberately slow
> Argon2id. A refresh token is 32 bytes of cryptographic randomness. There is nothing to
> guess, so a fast hash is entirely appropriate. **Same primitive, opposite correct choice,
> because the inputs have different entropy.**

**Rotation and reuse detection** — `backend/utils/refreshTokenStore.js`:

```js
export const rotateRefreshToken = async (rawToken, client = prisma) => {
  const tokenHash = hashRefreshToken(rawToken);
  const record = await client.refreshToken.findUnique({ where: { tokenHash } });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new RefreshTokenError("Refresh token invalid or expired");
  }

  if (record.usedAt) {
    // Same raw token presented twice: it was already rotated once, so this is
    // either a replay or the token was stolen. Kill the whole family.
    await revokeFamily(client, record.familyId);
    throw new RefreshTokenError("Refresh token reuse detected");
  }

  await client.refreshToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  const refreshToken = await createInFamily(client, record.userId, record.familyId);
  return { userId: record.userId, refreshToken };
};
```

**The concepts, built up in order:**

1. **Rotation.** Each refresh token may be used exactly once. Using it marks it `usedAt` and
   issues a brand-new one. So the credential in the user's browser changes every 15 minutes.
   A token stolen from a network log is worthless within minutes.

2. **Family.** All tokens descended from one login share a `familyId`. Login creates a family;
   every rotation adds a token to the same family.

```js
// Starts a fresh rotation family for a new login/register — not a rotation of
// an existing token, so it never touches another family's rows.
export const issueRefreshFamily = (userId, client = prisma) =>
  createInFamily(client, userId, generateId());
```

3. **Reuse detection.** Here is the reasoning, and it is genuinely elegant. Under rotation, a
   legitimate client never presents the same refresh token twice — it always has the newest
   one. So if an already-used token arrives, **exactly one of two things happened**: a thief
   copied the token, or the legitimate user's token was stolen and already used by a thief.
   Either way, one party is an attacker, and the server cannot tell which is which.

The safe response is to assume compromise and **revoke everything in that family**:

```js
const revokeFamily = (client, familyId) =>
  client.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
```

Both parties are logged out. The real user re-enters their password (mildly annoying); the
attacker is locked out (the point). The rotation chain is what makes detection possible at
all — without rotation, a stolen token is simply used alongside the real one, forever,
undetectably.

**The visual:**

```text
Login  ──> familyId = F1
             │
             ├─ token A  (usedAt: null)
             │
        refresh with A
             │
             ├─ A.usedAt = now
             └─ token B  (usedAt: null, same family F1)
                        │
                   refresh with B
                        │
                        ├─ B.usedAt = now
                        └─ token C  (usedAt: null, F1)

  ATTACKER replays token A (stolen earlier):
             │
             └─ A.usedAt is already set  ──>  REVOKE EVERY TOKEN IN F1
                                              A, B, C all dead.
                                              Real user must log in again.
```

**The cookie.** `backend/controller/auth.js`:

```js
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v1/auth",
};
```

Every flag earns its place:

- **`httpOnly: true`** — JavaScript cannot read this cookie. `document.cookie` will not show
  it. This is the specific defence against **XSS** (cross-site scripting): if an attacker
  manages to run JavaScript on your page, they still cannot exfiltrate the refresh token.
- **`secure: <production only>`** — the cookie is only sent over HTTPS, so it cannot be read
  off a plain-HTTP connection. Off in development because `localhost` is HTTP.
- **`sameSite: "strict"`** — the browser only sends the cookie when the request originates
  from your own site. This is the defence against **CSRF** (cross-site request forgery):
  a malicious page cannot make the browser fire an authenticated request at your API,
  because the cookie simply will not be attached.
- **`path: "/api/v1/auth"`** — the cookie is only attached to requests under that path.
  Requests to `/api/v1/product` or `/api/v1/order` never carry it. **Least privilege applied
  to a credential's blast radius**: a bug that logs request headers on the order endpoint
  cannot leak the refresh token, because it was never sent there.

The old README explains why there is no CSRF token: `SameSite=strict` already blocks
cross-site cookie sending in every modern browser, and the API's authenticated endpoints use
a `Authorization` header (which a cross-site form cannot set) rather than cookie-only auth.
A CSRF token would be defence-in-depth, not a missing lock.

### 4.7 Confusable pair: the access token vs the `localStorage` "token"

This one trips up everybody reading this frontend for the first time.

Open the browser devtools on a logged-in ShopSphere session and you will find
`localStorage.token === "session"`. That is **not** a credential. It is a literal string.

`frontend/src/lib/session.ts` is explicit:

```ts
// ponytail: dozens of existing pages gate nav/UI purely on `localStorage.getItem('token')`
// being truthy, and rewriting all of them to a shared auth context is a much bigger
// change than "wire the new backend up". So `token` here is a non-functional sentinel,
// not a credential — it can't authenticate anything, it only keeps that UI check working.
// Upgrade path: replace those reads with a `useSession()` hook backed by this module.
const persistUiHints = (user: SessionUser) => {
  localStorage.setItem("token", "session");
  localStorage.setItem("isAdmin", String(user.admin));
  localStorage.setItem("isSeller", String(user.seller));
  localStorage.setItem("userId", user.id);
};
```

**What happened, chronologically.** Originally, the real JWT was stored in `localStorage`,
and about forty pages read it directly. Then the auth system was overhauled (commit
`50641bc`): access tokens moved into module memory, where JavaScript injected by an XSS
attack cannot trivially find them, and the axios interceptor was introduced to attach them
automatically. Rewriting forty pages was out of scope for that change, so the
`localStorage.token` key stayed — populated with a meaningless placeholder — purely so that
`if (localStorage.getItem("token"))` still means "logged in" for UI purposes.

**Why storing a real JWT in `localStorage` is bad.** `localStorage` is readable by any
JavaScript running on the page. One XSS hole — a vulnerable dependency, an unescaped review
comment — and the attacker reads the token and has the user's session. A module-scoped
variable is not a perfect defence (injected code running in the same context can still reach
a lot), but it is not *sitting in a well-known key waiting to be read*, and it disappears on
reload.

**The residual risk this leaves.** `isAdmin` and `isSeller` are also in `localStorage`, and
any user can edit them. Setting `localStorage.isAdmin = "true"` will make `NavBar.tsx` render
the admin links:

```tsx
// frontend/src/components/NavBar.tsx
const isAdmin = localStorage.getItem("isAdmin") === "true";
...
{token && isAdmin && (
  <Link to="/admin" className={navLink}>...
```

This is **not** a privilege escalation, because every admin API endpoint independently checks
`req.user.role === "admin"` from the signed JWT. The forged user sees admin buttons and gets
403 on everything behind them. That is the correct security posture — *client-side role
checks are for showing the right UI; server-side role checks are for security* — but it
demonstrates why you must never let the two be confused.

### 4.8 Authorization and RBAC

**Authentication vs authorization** — the pair everyone mixes up:

> **Authentication** = *who are you?* Proving identity. In ShopSphere: presenting a valid JWT.
>
> **Authorization** = *what may you do?* Deciding permissions. In ShopSphere: checking role
> and ownership.

Authentication happens once per request in `authenticate`. Authorization happens in two
different places, at two different granularities.

**RBAC — Role-Based Access Control.** Rather than assigning permissions to individuals, you
assign each user a **role**, and permissions attach to roles. ShopSphere has three roles,
stored in one column:

```prisma
model User {
  role  String  @default("user") // "user" | "admin" | "seller"
}
```

| Role | May do |
|---|---|
| `user` | Browse, cart, order, cancel/return own orders, review, receive notifications |
| `seller` | Everything a user can, plus: create/update/delete **own** products, set discounts, view **own** orders and revenue, process returns for **own** products — **only once `isVerified`** |
| `admin` | Approve/reject sellers, manage all users, manage promo codes, view platform revenue, process any return, release refunds |

**Layer 1 — coarse role checks, in middleware.** Cheap, declarative, visible in the route file:

```js
productRouter.post("/create", verifyToken, authorizeSeller, checkSellerVerification, createProduct);
```

**Layer 2 — fine-grained ownership checks, in controllers.** A middleware cannot express
"this seller owns *this specific* product", because that requires loading the product:

```js
// backend/controller/productController.js — updateSellerProduct
const product = await prisma.product.findUnique({ where: { id } });
if (!product) {
  return res.status(404).json({ message: "Product not found" });
}
if (product.sellerId !== sellerId) {
  return res.status(403).json({ message: "You can only update your own products" });
}
```

```js
// backend/controller/order.js — cancelOrder
if (order.userId !== userId) {
  return res.status(403).json({ message: "Not authorized to cancel this order" });
}
```

```js
// backend/controller/payment.js — checkout
if (order.userId !== userId) {
  const err = new Error("Not authorized for this order");
  err.statusCode = 403;
  throw err;
}
```

> **This second layer is the one that matters most, and the one most often forgotten.** A
> system with perfect role checks and no ownership checks lets any customer cancel any other
> customer's order — they *are* a customer, after all. The technical name for missing this is
> **IDOR** (Insecure Direct Object Reference), and it is one of the most common serious
> vulnerabilities in real web applications.

ShopSphere gets this right on most order endpoints and on all seller-product endpoints. §8.9
lists the endpoints where it is missing.

**The verification sub-state.** Sellers have a third dimension beyond role: approval.

```prisma
model User {
  isVerified                   Boolean   @default(false)
  verificationRequestDate      DateTime?
  verificationApprovedDate     DateTime?
  verificationRejectionReason  String?
}
```

Set at registration (`backend/controller/auth.js`):

```js
if (role === "seller") {
  userData.shopName = shopName;
  userData.shopDescription = shopDescription || "";
  userData.isVerified = false;
  userData.verificationRequestDate = new Date();
} else {
  userData.isVerified = true;
}
```

Customers are auto-verified (the field is meaningless for them); sellers start unverified.
**Why gate sellers at all?** In a marketplace, the platform's reputation is the product. An
unvetted seller listing counterfeit goods damages every other seller and the platform. The
manual approval step is a business control expressed as one boolean and one middleware.

### 4.9 The order lifecycle, and why stock is deducted late

**The concept: a state machine.** An order is not a static record; it moves through named
states, and only certain transitions are legal. Writing those states and transitions down
explicitly is what stops an order from being, say, cancelled after it was delivered.

**ShopSphere's states** (all stored as free-text in `Order.status`):

```text
                    ┌─────────┐
                    │ Pending │  ← created; payment not yet confirmed
                    └────┬────┘
              ┌──────────┼──────────┐
              │          │          │
       payment OK   user cancels  (abandoned: stays Pending forever)
              │          │
              v          v
        ┌───────────┐  ┌───────────┐
        │ Confirmed │  │ Cancelled │
        └─────┬─────┘  └───────────┘
              │  ^
              │  └──── user may still cancel from Confirmed
              │        (stock restored)
       seller advances
              │
              v
       ┌────────────┐
       │ Processing │
       └─────┬──────┘
             v
        ┌─────────┐
        │ Shipped │
        └────┬────┘
             v
       ┌───────────┐
       │ Delivered │
       └─────┬─────┘
             │  within 7 days
             v
     ┌──────────────────┐
     │ Return Requested │
     └────────┬─────────┘
        ┌─────┴──────┐
        v            v
┌────────────────┐ ┌─────────────────┐
│ Return Approved│ │ Return Rejected │
└───────┬────────┘ └─────────────────┘
        │ admin releases refund
        v
┌─────────────────┐
│ Refund Released │
└─────────────────┘
```

**Where each transition is enforced:**

| Transition | Function | Guard in code |
|---|---|---|
| → Pending | `createOrder` / `createBulkOrderFromCart` | schema default `"Pending"` |
| Pending → Confirmed | `confirmOrderCore` | `if (primaryOrder.status !== 'Pending') return { alreadyConfirmed: true }` |
| Pending/Confirmed → Cancelled | `cancelOrder` | `cancellableStatuses = ["Pending", "Confirmed"]` |
| Confirmed → Processing/Shipped/Delivered | `updateSellerOrderStatus` | `validStatuses` array + seller ownership check |
| Delivered → Return Requested | `requestReturn` | status must be `"Delivered"` **and** within 7 days |
| Return Requested → Approved/Rejected | `processReturn` | `if (order.status !== "Return Requested") return 400` |
| Return Approved → Refund Released | `releaseRefund` | `if (order.status !== "Return Approved") return 400` |

**A modelling observation.** `status` is a plain `String` with no database-level constraint.
Nothing stops a bug writing `"Shiped"`. A PostgreSQL `ENUM` type, or a `CHECK` constraint,
would make invalid states unrepresentable rather than merely unwritten. Prisma supports
`enum` natively. This is a straightforward hardening opportunity.

**Now the most important design decision in the whole application: when is stock deducted?**

Two candidate moments:

- **At order creation** — the instant the customer clicks "Place order", before payment.
- **At payment confirmation** — only once money has actually been received.

ShopSphere chose the second, and says so at the exact spot:

```js
// backend/controller/order.js — createOrder
// Stock will be deducted AFTER payment confirmation, not immediately
// This prevents stock reduction if payment is cancelled
```

**Deduct-at-creation:**
- ✅ No overselling: stock is reserved the moment someone commits to buying.
- ❌ Abandoned checkouts silently destroy availability. A customer who opens checkout and
  wanders off has removed a unit from sale. A trivial script placing and abandoning orders
  can zero out your entire catalogue — a **denial-of-inventory attack**.
- ❌ Requires a background job to release expired reservations, which is another moving part
  that can fail.

**Deduct-at-confirmation (what this repo does):**
- ✅ Only real, paid sales consume stock. Abandonment costs nothing.
- ✅ No reaper job needed.
- ❌ **Overselling is possible.** Between the stock check at order creation and the deduction
  at confirmation, another customer can buy the last unit. Both orders will be confirmed;
  stock goes negative.

You can see the oversell hole in the code. `createOrder` checks:

```js
if (quantity > availableStock) {
  return res.status(400).json({ message: `Only ${availableStock} units available` });
}
```

And `confirmOrderCore` deducts **without re-checking**:

```js
const { updatedProduct, updatedOrder } = await prisma.$transaction(async (tx) => {
  const product = await adjustStock(productId, quantity, selectedColor, selectedStorage, -1, tx);
  if (!product) return { updatedProduct: null, updatedOrder: null };

  const orderRow = await tx.order.update({
    where: { id: orderId },
    data: { status: 'Confirmed', confirmedAt },
    include: { product: true },
  });

  await updateFirstRevenueByOrder(orderId, { status: "Completed" }, tx);

  return { updatedProduct: product, updatedOrder: orderRow };
});
```

`adjustStock` uses `{ increment: -quantity }`, which will happily take a count below zero.

**What would close it** (again, describing an alternative, not the repo): make the deduction
conditional, so the database refuses when stock is insufficient. For instance, an
`updateMany` with a `where: { id, quantity: { gte: quantity } }` returning `count === 0` when
it did not apply, or a raw `UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND
quantity >= $1`. Then confirmation of the second order fails cleanly and the customer is
refunded rather than silently oversold.

**Why the trade-off is defensible as it stands.** The window is narrow (seconds to minutes,
between checkout and eSewa returning), the catalogue is small-scale, and the failure mode
(rare oversell, resolved by refunding one customer) is less damaging day to day than the
alternative (routine loss of availability to abandoned carts). It is still a known, real gap
and is worth documenting on the roadmap rather than forgetting.

**`confirmOrderCore` — the shape that makes the whole payment flow work.** Its signature and
its opening comment:

```js
// Core confirm-and-deduct-stock logic, independent of req/res so it can run both from the
// user-facing route below (after an auth + payment check) and from the eSewa webhook once a
// PaymentEvent has verified the charge actually succeeded.
// If order has orderGroupId, confirms all orders in the group. Returns alreadyConfirmed:true
// as a no-op if the order isn't Pending anymore (safe to call more than once).
export const confirmOrderCore = async (orderId) => {
```

Three properties, each deliberate:

1. **No `req`/`res`.** It is a plain async function of an order id. That is what lets both an
   HTTP route and the payment webhook call it.
2. **Idempotent.** Calling it twice for the same order does nothing the second time — the
   `status !== 'Pending'` guard returns `alreadyConfirmed: true`. This matters enormously,
   because in the real flow it *is* called twice: once by the webhook, once by the
   `Success.tsx` page.
3. **Group-aware.** A cart checkout creates several `Order` rows sharing an `orderGroupId`;
   confirming any one of them confirms all of them.

```js
const ordersToConfirm = primaryOrder.orderGroupId
    ? await prisma.order.findMany({ where: { orderGroupId: primaryOrder.orderGroupId }, include: { product: true } })
    : [primaryOrder];
```

**The route wrapper adds the security gate:**

```js
// backend/controller/order.js — confirmOrderAndDeductStock
const payment = await prisma.payment.findFirst({
  where: primaryOrder.orderGroupId ? { orderGroupId: primaryOrder.orderGroupId } : { orderId },
  orderBy: { createdAt: "desc" },
});
if (payment && payment.status !== "Succeeded") {
  return res.status(402).json({ message: "Payment not verified yet. Please wait a moment and try again." });
}
```

- Ownership is checked first (`primaryOrder.userId !== userId` → 403).
- If a `Payment` row exists, it **must** be `Succeeded`. This is the lock: a customer cannot
  call `/order/confirm/:id` directly and get free goods, because the `Payment` row is only
  flipped to `Succeeded` by the webhook after a server-to-server verification with eSewa.
- **`if (payment && ...)`** — the gate is skipped when there is no `Payment` row at all. The
  comment says this matches pre-existing behaviour for orders that never went through eSewa,
  e.g. cash on delivery. Worth knowing: it means an order created but never sent to checkout
  can be confirmed by its owner without payment. Whether that is a feature (COD) or a hole
  depends on whether COD is genuinely supported — `backend/chatbot/faqs.json` says it is,
  though no other code models it.
- **402 Payment Required** is a rarely used status code, and this is exactly its intended
  meaning. Choosing it over a generic 400 lets the frontend distinguish "wait and retry" from
  "this will never work".

### 4.10 Idempotency

**The concept, from zero.** An operation is **idempotent** if doing it twice has the same
effect as doing it once. Reading a value is idempotent. Setting `x = 5` is idempotent.
`x = x + 1` is *not*. "Charge this customer Rs. 50,000" is emphatically not.

**Why it matters here.** Networks are unreliable in a specific, nasty way: when a request
times out, the client **cannot tell** whether the server never received it, or received and
processed it but the response was lost. So the client faces a dilemma — retry and risk
double-charging, or not retry and risk a lost order.

The standard solution: the **idempotency key**. The client generates a unique id for the
*intent* and sends it with the request. The server records it. If the same key arrives again,
the server returns the original result instead of doing the work twice. Now retrying is safe,
and the dilemma disappears.

**How ShopSphere implements it.** The client generates a fresh UUID per checkout attempt:

```tsx
// frontend/src/pages/CartCheckout.tsx
const checkoutRes = await axios.post(
  `${import.meta.env.VITE_BACKEND_URL}/api/v1/payment/checkout`,
  { orderId },
  { headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": uuidv4() } }
);
```

The server requires it:

```js
// backend/controller/payment.js
const idempotencyKey = req.headers["idempotency-key"];
if (!idempotencyKey) {
  return res.status(400).json({ message: "Idempotency-Key header is required" });
}
```

The mechanism lives in `backend/utils/idempotency.js`. This file rewards careful reading:

```js
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export const hashPayload = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

// Runs `fn` exactly once per Idempotency-Key. Concurrent requests with the same key race on
// the idempotency_keys unique constraint: Postgres blocks the second INSERT until the first
// transaction commits, then rejects it with 23505 (Prisma P2002) — that block *is* the row
// lock the spec asks for, no manual SELECT ... FOR UPDATE needed.
export const withIdempotency = async (key, requestPayload, fn) => {
  // ponytail: inline prune instead of a cron job — cheap (indexed column), runs on the hot path.
  await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - PRUNE_AFTER_MS) } },
  });

  const requestHash = hashPayload(requestPayload);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.idempotencyKey.create({ data: { key, requestHash, status: "processing" } });
      const result = await fn(tx);
      await tx.idempotencyKey.update({
        where: { key },
        data: { status: "completed", statusCode: result.statusCode, response: result.body },
      });
      return { replayed: false, ...result };
    });
  } catch (err) {
    if (err.code !== "P2002") throw err;

    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
    if (!existing) throw err;

    if (existing.requestHash !== requestHash) {
      const conflict = new Error("Idempotency-Key was already used with a different request payload");
      conflict.statusCode = 422;
      throw conflict;
    }
    if (existing.status === "completed") {
      return { replayed: true, statusCode: existing.statusCode, body: existing.response };
    }
    const pending = new Error("A request with this Idempotency-Key is already being processed");
    pending.statusCode = 409;
    throw pending;
  }
};
```

**The central insight is the concurrency handling.** The naive approach is:

```
if (key exists in DB) return stored response
else { do the work; store the response }
```

That has a **race condition**. Two requests with the same key arrive at the same moment.
Both check — neither sees a row. Both proceed. Both charge. The gap between "check" and "act"
is where the bug lives, and no amount of application-level care closes it.

The fix used here is to **let the database arbitrate**. The `key` column is the primary key of
`idempotency_keys`, so it is unique. Both requests attempt to INSERT it. PostgreSQL's
behaviour is precisely what is needed: the first INSERT takes a lock on that key; the second
INSERT **blocks**, waiting, until the first transaction commits or rolls back. Then:

- If the first committed, the second's INSERT violates the unique constraint and fails with
  SQL error 23505 (Prisma code `P2002`). The catch block handles it.
- If the first rolled back, the second's INSERT succeeds and it does the work.

Either way, exactly one execution. The comment names this precisely: *that block **is** the
row lock*. No `SELECT ... FOR UPDATE`, no application mutex, no Redis lock.

**The `requestHash` check** guards against a different mistake: the same key reused for a
*different* request. That means a client bug (reusing a key it should have regenerated). It
returns **422 Unprocessable Entity** rather than silently replaying the wrong response —
which would be far more confusing to debug.

**Three response states, three status codes:**

| Situation | Status | Meaning |
|---|---|---|
| First time, work done | 201 (from `fn`) | Fresh execution |
| Same key, same payload, already completed | 201 + `Idempotent-Replayed: true` | Stored response replayed |
| Same key, same payload, still processing | 409 Conflict | Try again shortly |
| Same key, different payload | 422 Unprocessable | Client bug |

The header is set by the caller:

```js
res.setHeader("Idempotent-Replayed", String(replayed));
return res.status(statusCode).json(body);
```

**The pruning.** Old keys are deleted inline on every call, with an honest comment that a cron
job would be the usual answer. The `@@index([createdAt])` in the schema makes the delete
cheap. The trade-off — a delete on the hot path of every checkout — is small at this scale,
but it is the kind of thing that shows up as latency at high volume.

**Retention matters for correctness, not just cleanliness.** Keys are kept 24 hours. If a
client retried after 25 hours, its key would be gone and the request would execute again.
24 hours vastly exceeds any realistic retry window, so this is fine — but it is a deliberate
bound, not an accident.

### 4.11 Database transactions

**The concept.** A **transaction** groups several database operations so that either all of
them happen, or none of them do. The classic example is a bank transfer: debit one account,
credit another. If the process crashes between the two, money must not vanish.

> **Jargon: ACID.** The four guarantees transactions provide.
> **Atomicity** — all or nothing.
> **Consistency** — constraints hold before and after.
> **Isolation** — concurrent transactions do not see each other's half-finished work.
> **Durability** — once committed, it survives a power cut.

**Why ShopSphere needs them.** Confirming an order does three separate writes:

1. Deduct stock from the product (and its variant rows).
2. Set the order status to `Confirmed`.
3. Mark the revenue record `Completed`.

If the process dies after step 1, stock has been consumed for an order that still shows as
`Pending`. The customer may cancel it — and cancellation restores stock, so now stock is
restored for a deduction that... actually did happen. The counts drift, silently, forever.

**The implementation** — `confirmOrderCore`:

```js
// Stock deduction, order status flip, and revenue update happen atomically —
// a failure partway through must not leave stock deducted but the order still Pending.
const { updatedProduct, updatedOrder } = await prisma.$transaction(async (tx) => {
  const product = await adjustStock(productId, quantity, selectedColor, selectedStorage, -1, tx);
  if (!product) return { updatedProduct: null, updatedOrder: null };

  const orderRow = await tx.order.update({
    where: { id: orderId },
    data: { status: 'Confirmed', confirmedAt },
    include: { product: true },
  });

  await updateFirstRevenueByOrder(orderId, { status: "Completed" }, tx);

  return { updatedProduct: product, updatedOrder: orderRow };
});
```

**The key mechanic: `tx`.** `prisma.$transaction(async (tx) => {...})` hands your callback a
special client. Every operation performed on `tx` joins the transaction. Every operation
performed on the plain `prisma` client does **not** — it runs outside, and will not be rolled
back.

This is exactly why `adjustStock` and `updateFirstRevenueByOrder` take a `client` parameter.
Passing `tx` enrols them. Forgetting to pass it would be a silent, subtle bug: the code would
run fine, tests would pass, and the atomicity guarantee would simply not exist.

**Everywhere transactions are used in this repo:**

```js
// cancelOrder — restore stock and flip status together
order = await prisma.$transaction(async (tx) => {
  await adjustStock(order.product.id, quantity, order.variantColor, order.variantStorage, 1, tx);
  return tx.order.update({
    where: { id: orderId },
    data: { status: "Cancelled", cancelledAt: new Date() },
    include: { product: true },
  });
});
```

```js
// userDeleteOrder — restore stock and delete the order together
const restoresStock = ['Confirmed', 'Processing', 'Shipped'].includes(order.status);
await prisma.$transaction(async (tx) => {
  if (restoresStock) {
    await adjustStock(order.product.id, order.quantity, order.variantColor, order.variantStorage, 1, tx);
  }
  await tx.order.delete({ where: { id } });
});
```

```js
// payment.js — record the event and update payment status together
await prisma.$transaction(async (tx) => {
  await tx.paymentEvent.create({ data: { ..., gatewayEventId } });
  await tx.payment.update({
    where: { transactionUuid },
    data: { status: newStatus, gatewayRefId: statusResult.ref_id || null },
  });
});
```

```js
// idempotency.js — key insert + the guarded work + key completion, all in one
return await prisma.$transaction(async (tx) => {
  await tx.idempotencyKey.create({ data: { key, requestHash, status: "processing" } });
  const result = await fn(tx);
  await tx.idempotencyKey.update({ where: { key }, data: { status: "completed", ... } });
  return { replayed: false, ...result };
});
```

```js
// seedDemoData.js — the strictest isolation level, plus a retry loop
}, { isolationLevel: "Serializable" });

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    return await seedTransaction();
  } catch (error) {
    const retryable = error?.code === "P2002" || error?.code === "P2034";
    if (!retryable || attempt === 3) throw error;
  }
}
```

> **Jargon: isolation level.** How strictly the database prevents concurrent transactions
> from interfering. `Serializable` is the strictest — the result must be identical to running
> the transactions one after another. It is also the most likely to abort a transaction with
> a serialization failure (`P2034`), which is why the retry loop exists. Used here because
> several backend instances may boot simultaneously and try to seed the same demo rows.

**Where transactions are deliberately NOT used.** Order creation:

```js
const order = await prisma.order.create({ data: {...} });      // write 1

try {
  await prisma.revenue.create({ data: {...} });                 // write 2 — separate
  console.log("Revenue record created for order:", order.id);
} catch (revenueError) {
  console.error("Error creating revenue record:", revenueError);
  // Don't fail the order if revenue record fails
}

try {
  const orderNumber = generateOrderNumber(order.id, order.createdAt);
  await prisma.order.update({ where: { id: order.id }, data: { orderNumber } });  // write 3
  order.orderNumber = orderNumber;
} catch (numErr) {
  console.error("Order number generation error (non-fatal):", numErr);
}
```

Three separate writes, no transaction, and the second and third are explicitly allowed to
fail. The old README states this was intentional: order *creation* touches no money and no
stock yet, so the consequence of partial failure is a missing analytics row or a missing
human-readable order number — recoverable, not corrupting. Full transactionality was applied
where stock and money change hands.

**Is that the right call?** Arguably a revenue row missing for a real order is a data
integrity problem worth a transaction. But it is a *defensible* prioritisation, and it is
documented rather than accidental — which is the difference between a trade-off and a bug.

### 4.12 Webhooks, signatures, and the eSewa integration

This is the most security-critical part of the application, so it is built from the ground up.

#### 4.12.1 What a webhook is

Normally your server calls someone else's server and waits for an answer. A **webhook** is
the reverse: you give another service a URL, and *it* calls *you* when something happens.
"Don't call us, we'll call you."

Payments need this because a payment is not instantaneous. The customer leaves your site,
authenticates with their wallet, maybe waits for an OTP. Your server cannot sit and wait. So
the gateway calls you back when it is done.

#### 4.12.2 Why any callback must be treated as hostile

The callback URL is on the public internet. **Anyone can call it.** If your handler is
"whatever arrives at `/payment-success/:orderId`, mark that order paid", then an attacker
simply visits that URL with their own order id and gets free goods.

This is not theoretical for this repository — it is the vulnerability described, in the past
tense, in `backend/app.js`:

```js
// eSewa redirects the browser here after payment. These used to redirect straight to the
// frontend with zero server-side verification (the frontend then trusted the redirect alone
// and deducted stock).
```

Two defences exist against this, and ShopSphere uses **both**.

#### 4.12.3 Defence one: HMAC signatures

**What a signature is.** A short value computed from a message plus a secret key, such that:
anyone with the secret can compute it, anyone with the secret can verify it, and **nobody
without the secret can produce a valid one** for a message they invented.

**HMAC** (Hash-based Message Authentication Code) is the standard construction. It combines a
hash function (here SHA-256) with a shared secret in a way that resists known attacks.

> **Signature vs encryption — a common confusion.** Encryption hides content: only the holder
> of the key can read it. A signature does not hide anything — the message is fully readable
> — it proves the message came from someone holding the secret and was not altered. Payment
> callbacks use signatures, not encryption: the amount is not a secret, but its authenticity
> is essential.

**Signing the outgoing form** — `backend/utils/esewa.js`:

```js
const SECRET_KEY = process.env.ESEWA_SECRET_KEY;
const PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE || "EPAYTEST";

const hmacBase64 = (message) => crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");

// Signs the fields eSewa requires on the outbound checkout form. Secret never leaves the server.
export const signCheckoutFields = ({ totalAmount, transactionUuid, productCode = PRODUCT_CODE }) => {
  const signedFieldNames = "total_amount,transaction_uuid,product_code";
  const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;
  return { signature: hmacBase64(message), signedFieldNames, productCode };
};
```

The exact string format (`field=value,field=value`, in the order named by
`signed_field_names`) is dictated by eSewa's specification. Both sides must build the string
identically or the signatures will not match.

**Verifying the incoming callback:**

```js
export const decodeCallbackPayload = (base64Data) =>
  JSON.parse(Buffer.from(base64Data, "base64").toString("utf-8"));

// Verifies the signature eSewa attaches to its success_url `data` payload.
export const verifyCallbackSignature = (payload) => {
  if (!payload?.signed_field_names || !payload?.signature) return false;
  const message = payload.signed_field_names
    .split(",")
    .map((field) => `${field}=${payload[field]}`)
    .join(",");
  return hmacBase64(message) === payload.signature;
};
```

The callback arrives with a `data` query parameter that is Base64-encoded JSON. Decode it,
rebuild the signed string from the fields eSewa says it signed, recompute the HMAC, compare.
If they differ, the payload was forged or tampered with.

> **Base64 is encoding, not encryption.** It renders binary data as safe ASCII so it survives
> a URL. Anyone can decode it in one line. It provides zero security. The security is entirely
> in the signature.

#### 4.12.4 Defence two: the authoritative status check

A signature proves the message is genuine. It does **not** prove the payment succeeded — for
example, a genuine, correctly signed callback could arrive twice, or a browser could be
pointed at a stale but genuine URL.

So ShopSphere adds a second, stronger check: **ask eSewa directly.**

```js
// Server-to-server confirmation call — eSewa has no push webhook, so this status check is what
// authoritatively confirms a transaction rather than trusting the browser redirect alone.
export const checkTransactionStatus = async ({ productCode = PRODUCT_CODE, totalAmount, transactionUuid }) => {
  const url = `${STATUS_CHECK_URL}?product_code=${encodeURIComponent(productCode)}&total_amount=${encodeURIComponent(totalAmount)}&transaction_uuid=${encodeURIComponent(transactionUuid)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`eSewa status check failed with HTTP ${response.status}`);
  }
  return response.json(); // { product_code, transaction_uuid, total_amount, status, ref_id }
};
```

This is a **server-to-server** call: ShopSphere's backend calls eSewa's API directly. The
browser is not involved and cannot influence it. Whatever eSewa says here is the truth.

**Critically, note what is sent:** `payment.amount`, read from ShopSphere's own database — not
an amount from the callback. So even a perfectly forged callback claiming a different amount
would be checked against the amount ShopSphere expects.

**The important architectural framing.** The old README states that eSewa has no push
webhook. So the browser redirect is not really a webhook at all — it is a *hint that
something happened*, which triggers the real verification. Naming the handlers
`esewaSuccessWebhook` / `esewaFailureWebhook` is slightly generous; they are redirect
handlers that perform webhook-equivalent verification. The comment in `payment.js` is careful
about this:

```js
// GET target for eSewa's success_url. eSewa has no server-to-server webhook push — this
// browser redirect, verified against eSewa's own status-check API before anything is trusted,
// is this system's webhook-equivalent entrypoint (see processEsewaEvent above).
```

#### 4.12.5 Defence three: event deduplication

Even a genuine, verified callback can arrive more than once — the user refreshes, the browser
retries, the gateway redelivers.

```js
const gatewayEventId = `${transactionUuid}:${statusResult.status}`;
```

and in the schema:

```prisma
model PaymentEvent {
  gatewayEventId String?  @unique
}
```

The second attempt to record the same `(transaction, status)` pair violates the unique
constraint, is caught, and returns the already-processed result:

```js
} catch (err) {
  if (err.code === "P2002") {
    // Same gateway event already recorded by a concurrent or redelivered callback.
    const fresh = await prisma.payment.findUnique({ where: { transactionUuid } });
    return { ok: true, payment: fresh, alreadyProcessed: true };
  }
  throw err;
}
```

**Same technique as idempotency, same reason: the database is the only place where a check
and an action can be genuinely atomic.**

There is a further early exit before any of this:

```js
export const processEsewaEvent = async (transactionUuid, { source } = {}) => {
  const payment = await prisma.payment.findUnique({ where: { transactionUuid } });
  if (!payment) return { ok: false, reason: "unknown_transaction" };
  if (payment.status !== "Initiated") {
    return { ok: true, payment, alreadyProcessed: true };
  }
  ...
```

An unknown transaction is rejected outright; an already-resolved one is a no-op. So there are
three independent layers of duplicate protection.

#### 4.12.6 Confusable pair: payment *intent* vs payment *method* vs payment *event*

These three words get used loosely, and this codebase has concrete instances of two of them.

> **Payment method** — *how* the customer pays: eSewa wallet, a specific card, cash on
> delivery. It is a reusable capability, usually attached to a customer.
>
> **Payment intent** — *one specific attempt* to collect *one specific amount* for *one
> specific order*. It has a lifecycle: created → processing → succeeded or failed. It is not
> reusable; a retry creates a new intent.
>
> **Payment event** — a single immutable fact recorded about an intent: "an intent was
> created", "the charge succeeded".

ShopSphere's `Payment` model **is a payment intent**, even though it is not named that:

```prisma
model Payment {
  id              String   @id @db.VarChar(24)
  orderId         String   @db.VarChar(24)
  orderGroupId    String?
  transactionUuid String   @unique
  productCode     String
  amount          Float
  status          String   @default("Initiated") // Initiated | Succeeded | Failed
  gatewayRefId    String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("payments")
}
```

One row per checkout attempt, tied to one order, with a fixed amount and a three-state
lifecycle. That is an intent. And the very first event recorded is literally named:

```js
await tx.paymentEvent.create({
  data: {
    id: generateId(),
    aggregateId: order.id,
    eventType: "intent_created",
    payload: { transactionUuid, amount: totalAmount, productCode, paymentId: payment.id },
  },
});
```

ShopSphere has **no payment-method model at all**. Every payment goes through eSewa; nothing
is stored about the customer's wallet or card. That is the correct minimal design for a
single-gateway integration, and it also means the application handles no sensitive payment
credentials whatsoever — a large compliance burden simply avoided.

#### 4.12.7 Confusable pair: `Payment` vs `PaymentEvent`

These two tables look redundant. They are not; they are two halves of a well-known pattern.

```prisma
// Append-only audit trail of every payment state transition. Never updated or deleted by
// application code. gatewayEventId dedupes redelivered/duplicate gateway callbacks.
model PaymentEvent {
  id             String   @id @db.VarChar(24)
  aggregateId    String   @db.VarChar(24)
  eventType      String
  payload        Json
  gatewayEventId String?  @unique
  createdAt      DateTime @default(now())

  @@index([aggregateId, createdAt])
  @@map("payment_events")
}

// Read-model projection of payment state, kept in sync by inserts into PaymentEvent.
model Payment { ... }
```

> **Event sourcing (the idea, simplified).** Instead of storing only *current state*, store
> the ordered list of *things that happened*. Current state is then derivable by replaying
> the events. The benefits: a complete audit trail, the ability to answer "what did this look
> like last Tuesday?", and the ability to detect bugs after the fact by replaying.
>
> **Projection / read model.** Replaying every event on every read would be slow, so you keep
> a pre-computed summary of current state and update it as events arrive. That summary is a
> projection. It is derived data — if it were ever lost, it could be rebuilt from the events.

So: `PaymentEvent` is the **truth**; `Payment` is the **convenient summary**.

**And the append-only guarantee is enforced by the database, not by convention.** Migration
`20260824183326_ledger_append_only/migration.sql` is four lines, and they are among the most
interesting in the repo:

```sql
-- Enforce append-only at the DB role level: the app's DB role can INSERT and SELECT payment
-- events but cannot UPDATE or DELETE them, so a bug (or a compromised app process) can't rewrite
-- the audit trail. Adjust the role name below if your DATABASE_URL user differs from "shopsphere".
REVOKE UPDATE, DELETE ON payment_events FROM shopsphere;
```

**Why this is stronger than a code comment.** A comment saying "never update this table" is
advisory — the next developer, or an attacker who achieves code execution, can ignore it. A
`REVOKE` is enforced by PostgreSQL: the application's database user *physically lacks the
privilege*. An `UPDATE payment_events ...` fails with a permission error no matter who issues
it or how.

This is **defence in depth** applied to the audit trail specifically — the one piece of data
whose whole value depends on being untamperable. If a payment is ever disputed, the ledger is
evidence, and evidence the application could rewrite is not evidence.

Two practical caveats the comment itself flags: the role name is hardcoded as `shopsphere`,
so a different `DATABASE_URL` user needs the migration adjusted; and if the application
connects as the table's owner or a superuser, `REVOKE` on that role has no effect, since
owners retain their privileges.

### 4.13 CORS — the Same-Origin Policy

**The concept.** Browsers enforce the **Same-Origin Policy**: JavaScript on
`https://evil.com` may not read responses from `https://yourbank.com`. Without this rule, any
website you visited could quietly read your email and your bank balance, because your browser
would helpfully attach your cookies.

> **Jargon: origin.** The triple (scheme, host, port). `http://localhost:5173` and
> `http://localhost:4000` are **different origins** — same host, different port. So
> ShopSphere's own frontend calling its own backend is already a cross-origin request.

**CORS** (Cross-Origin Resource Sharing) is the mechanism by which a server says "these
specific other origins are allowed to read my responses". The server sends
`Access-Control-Allow-Origin` headers; the browser enforces them.

> **CORS protects the browser's user, not the server.** `curl` ignores CORS entirely, because
> there is no user whose cookies could be abused. CORS is never a substitute for
> authentication and authorization.

**ShopSphere's policy** (`backend/app.js`):

```js
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, etc.)
        if (!origin) return callback(null, true);
        // Allow Capacitor iOS/Android origins
        if (
            origin === 'capacitor://localhost' ||
            origin === 'http://localhost' ||
            origin === process.env.FRONTEND_URL ||
            /^http:\/\/localhost:\d+$/.test(origin) ||
            /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
            /^http:\/\/192\.168\./.test(origin) ||
            /^http:\/\/10\./.test(origin) ||
            /^http:\/\/172\./.test(origin)  // allow LAN + hotspot IPs
        ) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
}));
```

An **allow-list**, not a wildcard. `origin: "*"` would be the lazy option and is actually
forbidden in combination with `credentials: true` — browsers reject that pairing outright,
because it would mean "any site may make authenticated requests to me".

The entries, and why each exists:

| Entry | Purpose |
|---|---|
| `!origin` | Tools with no `Origin` header: curl, Postman, server-to-server |
| `capacitor://localhost` | The mobile WebView's origin |
| `process.env.FRONTEND_URL` | The configured production frontend |
| `/^http:\/\/localhost:\d+$/` | Any local dev port |
| `/^http:\/\/127\.0\.0\.1:\d+$/` | Same, by IP |
| `192.168.` / `10.` / `172.` | Private LAN ranges — testing from a phone on the same Wi-Fi |

**The honest security note.** The three private-range regexes are broad and, importantly,
are **unanchored**: `/^http:\/\/172\./` matches any origin beginning `http://172.`, which
includes public addresses in `172.32.x.x`–`172.255.x.x` (the private block is only
`172.16.0.0`–`172.31.255.255`). They exist for developer convenience and should be gated
behind `NODE_ENV !== "production"` before a real deployment. As written they ship to
production, where no legitimate browser origin should be a raw private-range IP.

### 4.14 Promo codes

**The concept.** A code a customer types to get a discount. Simple on the surface; the
complexity is in the rules: is it still valid, has this person already used it, is the basket
big enough, and is the discount capped.

**The schema:**

```prisma
model PromoCode {
  id            String   @id @db.VarChar(24)
  code          String   @unique
  description   String
  discountType  String
  discountValue Float
  minPurchase   Float    @default(0)
  maxDiscount   Float?
  usageLimit    Int?
  usedCount     Int      @default(0)
  validFrom     DateTime
  validUntil    DateTime
  isActive      Boolean  @default(true)
  createdById   String   @db.VarChar(24)
  createdBy     User     @relation("PromoCreatedBy", fields: [createdById], references: [id])
  createdAt     DateTime @default(now())

  usages PromoCodeUsage[]

  @@index([code, isActive])
  @@map("promo_codes")
}

model PromoCodeUsage {
  promoCodeId String    @db.VarChar(24)
  promoCode   PromoCode @relation(fields: [promoCodeId], references: [id], onDelete: Cascade)
  userId      String    @db.VarChar(24)
  user        User      @relation(fields: [userId], references: [id])

  @@id([promoCodeId, userId])
  @@map("promo_code_usages")
}
```

**`PromoCodeUsage` has a composite primary key** — `@@id([promoCodeId, userId])`. That is not
a style choice, it is the enforcement mechanism: the database physically cannot hold two rows
for the same (code, user) pair. "One use per customer" is a schema guarantee, not an
application check that could be raced.

The controller relies on exactly that:

```js
try {
  // Mark the code as used by this user; the composite primary key rejects a
  // duplicate the same way the old $addToSet no-op'd on a repeat id.
  await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCode.id, userId } });
} catch (usageError) {
  if (usageError?.code === "P2002") {
    return res.status(400).json({ message: "You have already used this promo code" });
  }
  throw usageError;
}
```

Third time this pattern appears — idempotency keys, gateway event ids, promo usage. **Let the
database enforce uniqueness; catch P2002.** It is worth internalising as a general technique.

**`discountType` and the two calculations** — `validatePromoCode`:

```js
let discountAmount = 0;
if (promoCode.discountType === "percentage") {
  discountAmount = (purchaseAmount * promoCode.discountValue) / 100;
  // Apply max discount cap if exists
  if (promoCode.maxDiscount && discountAmount > promoCode.maxDiscount) {
    discountAmount = promoCode.maxDiscount;
  }
} else {
  // Fixed discount
  discountAmount = promoCode.discountValue;
  // Discount cannot exceed purchase amount
  if (discountAmount > purchaseAmount) {
    discountAmount = purchaseAmount;
  }
}
```

**Why `maxDiscount` exists.** "20% off" on a Rs. 5,000 accessory costs you Rs. 1,000. The same
code on a Rs. 190,000 iPhone 17 Pro Max costs Rs. 38,000. `maxDiscount` bounds the exposure.
This is a real, expensive lesson many shops learn the hard way.

**Why the fixed discount is clamped.** Without `if (discountAmount > purchaseAmount)`, a
Rs. 500-off code on a Rs. 300 purchase would produce a negative total — and possibly a refund
to the customer. `Math.max(0, ...)` appears at the order layer too, as a second guard.

#### Confusable pair: **validate** vs **apply**

Two endpoints that sound like synonyms and are not:

> **`POST /promo/validate`** — a **dry run**. Checks every rule, computes the discount,
> returns the numbers. **Consumes nothing.** The customer can type a code, see "you save
> Rs. 2,400", change their mind, and nothing has been used up.
>
> **`POST /promo/apply`** — **consumes** the code: inserts the `PromoCodeUsage` row and
> increments `usedCount`.

**Where the design leaks.** Look at when the frontend calls `apply` —
`frontend/src/pages/CartCheckout.tsx`:

```tsx
// Apply promo code usage if discount is applied
if (appliedPromo?.code) {
  try {
    await axios.post(
      `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/apply`,
      { code: appliedPromo.code },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (promoError) {
    console.error("Error applying promo code:", promoError);
    // Continue even if promo apply fails
  }
}

// ... then create the orders, then start payment
```

The code is consumed **before** the order is created and long before payment succeeds. So a
customer who applies a promo and then abandons payment has burned their one use. And because
the failure is swallowed (`// Continue even if promo apply fails`), a failed apply still lets
the discounted order through — the discount is granted without the usage being recorded.

Worse, the discount amount itself is client-supplied at order creation:

```js
// backend/controller/order.js — createOrder
if (promoCode && promoCode.code && promoCode.discountAmount) {
  totalPrice = Math.max(0, totalPrice - promoCode.discountAmount);
  promoCodeStr = promoCode.code;
  promoDiscountAmount = promoCode.discountAmount;
}
```

`promoCode.discountAmount` comes from `req.body` (validated by zod as a non-negative number,
but not re-derived). A crafted request could claim a Rs. 100,000 discount on a code worth
Rs. 500 — and `checkout` then signs an eSewa form for that reduced amount, because it reads
`order.totalPrice` from the database. **The server does not re-validate the discount against
the promo code at order-creation time.**

**The correct design** — clearly stated as an alternative, not as what the repo does: send
only the **code** with the order, have the server re-run the full validation and compute the
discount itself, and record the usage inside the same transaction that confirms payment. That
makes the discount server-authoritative and ties consumption to a completed purchase. This is
the most significant business-logic gap in the codebase and is listed again in §8.9.

#### The promo double-discount subtlety

There is a genuinely tricky piece of accounting between single and bulk orders, and the code
comments it carefully.

**Single order** (`createOrder`) — the discount is baked into `totalPrice`:

```js
totalPrice = Math.max(0, totalPrice - promoCode.discountAmount);
```

**Bulk order** (`createBulkOrderFromCart`) — each order's `totalPrice` is its **undiscounted**
item total, and the discount is recorded separately on the first order only:

```js
let finalAmount = totalAmount;
if (promoCode && promoCode.code && promoCode.discountAmount) {
  finalAmount = Math.max(0, totalAmount - promoCode.discountAmount);
  // Save promo code to the first order (primary order for payment)
  const updatedFirst = await prisma.order.update({
    where: { id: createdOrders[0].id },
    data: { promoCode: promoCode.code, promoDiscountAmount: promoCode.discountAmount },
  });
  createdOrders[0] = updatedFirst;
}
```

So the payment layer must treat the two cases differently, and it does:

```js
// backend/controller/payment.js
// createOrder() already bakes any promo discount into totalPrice; createBulkOrder()
// only stores it on promoDiscountAmount (see order.js), so it's only subtracted here
// for the grouped/bulk case — subtracting it for both would double-discount single orders.
const groupTotal = orders.reduce((sum, o) => sum + o.totalPrice, 0);
const discount = order.orderGroupId
  ? orders.reduce((sum, o) => sum + (o.promoDiscountAmount || 0), 0)
  : 0;
const totalAmount = Math.max(0, groupTotal - discount);
```

**This is exactly the kind of bug that costs real money and is invisible in testing** — if a
single order's discount were subtracted twice, every discounted single-item purchase would be
undercharged, and nothing would fail loudly. The comment is doing genuine work here.

**The deeper lesson.** The inconsistency exists because two code paths independently decided
where to store the discount. The robust fix is to make both paths store it the same way. The
comment is a mitigation, not a cure — the next person to touch either path must read and
respect it.

### 4.15 Recommendations: the Apriori model

**The concept.** "Frequently bought together." Given the pattern of past baskets, which
products co-occur more often than chance would predict?

**The algorithm.** Apriori, market-basket analysis. Three numbers define a rule
"A implies B":

> **Support** — how often A and B appear together, as a fraction of all transactions.
> Support 0.05 means 5% of all baskets contained both. High support = common.
>
> **Confidence** — of the baskets containing A, what fraction also contain B?
> Confidence 0.8 means 80% of A-buyers also bought B. This is a directional, conditional
> probability.
>
> **Lift** — confidence divided by B's overall frequency. Lift > 1 means A genuinely
> *increases* the chance of B. Lift = 1 means no relationship. **Lift is the one that matters
> for recommendation quality**, because a product everyone buys anyway (a charging cable)
> will show high confidence with everything while adding no information.

**The offline pipeline.** `backend/recommendation/train_apriori.py`:

- Reads a CSV of `Transaction_ID, Items` (comma-separated item names).
- Normalises names so spelling variants merge:

```python
def normalize_item_name(name: str) -> str:
    """Normalize product names to merge spelling/spacing variants."""
    normalized = name.lower()
    normalized = normalized.replace("-", " ").replace("_", " ")

    # Strip Apple Watch "Series N" suffix -> "Apple Watch Series 9" -> "Apple Watch"
    normalized = re.sub(r'\bapple watch series\s*\d+\b', 'apple watch', normalized)
    normalized = re.sub(r'\b(apple watch ultra)\s*\d+\b', r'\1', normalized)
    # Strip iPad chip/size suffixes (e.g. "M4", "M2", "11 inch", "13 inch")
    normalized = re.sub(r'\bm\d\b', '', normalized)
    normalized = re.sub(r'\b\d{2}[\s-]?inch\b', '', normalized)
    ...
```

- Runs mlxtend's `apriori` and `association_rules`.
- Writes `output/recommendations_map.json`, shaped as documented in
  `backend/recommendation/README.md`:

```json
{
  "Mac Mini": [
    { "item": "Apple Magic Mouse", "support": 0.123, "confidence": 0.89, "lift": 2.34 }
  ]
}
```

**Why offline?** Running Apriori over ten thousand transactions inside a web request would
take seconds and burn CPU. Precomputing turns an expensive analytical job into a file read.

> **The general pattern: precomputation.** When a computation is expensive but its inputs
> change slowly, compute it on a schedule and serve the result. The cost is staleness — the
> recommendations reflect the data as of the last training run.

**Serving it** — `backend/controller/productController.js`:

```js
let recommendationCache = null;
let recommendationCacheLoadedAt = 0;
const RECOMMENDATION_CACHE_TTL_MS = 5 * 60 * 1000;

const getRecommendationMap = async () => {
  const now = Date.now();
  if (recommendationCache && now - recommendationCacheLoadedAt < RECOMMENDATION_CACHE_TTL_MS) {
    return recommendationCache;
  }

  const raw = await fs.readFile(RECOMMENDATION_FILE_PATH, "utf-8");
  recommendationCache = JSON.parse(raw);
  recommendationCacheLoadedAt = now;
  return recommendationCache;
};
```

> **Jargon: cache, and TTL.** A cache holds a copy of expensive-to-obtain data so subsequent
> requests are cheap. **TTL** (time to live) is how long the copy is trusted before being
> re-read. Here: 5 minutes, so a retrain becomes visible within 5 minutes without a restart.
>
> Note this cache is **per process**. Two backend instances have two independent caches and
> can briefly disagree. Harmless for recommendations; the same pattern would be dangerous for
> anything authoritative.

**The name-matching problem.** The trained model keys on product *names* from a CSV; the
database has its own product names. They will not match exactly. So the controller does
fuzzy matching, first normalising:

```js
const normalizeRecommendationKey = (value = "") =>
  value
    .toLowerCase()
    .replace(/[\-_]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
```

then trying an exact normalised match, then falling back to **Jaccard similarity**:

```js
const productTokens = new Set(normalizedProductName.split(" "));
const keyTokens = new Set(normalizedKey.split(" "));

const intersection = [...productTokens].filter(token => keyTokens.has(token));
const union = new Set([...productTokens, ...keyTokens]);
const similarity = intersection.length / union.size;
```

> **Jaccard similarity.** Shared words divided by total distinct words. `{iphone, 17, pro}`
> vs `{iphone, 17, pro, max}` → 3 shared / 4 total = 0.75. Simple, fast, and word-order
> independent.

A threshold of `> 0.6` gates the match. There is a further refinement when matching against
database products, which strips brand tokens before comparing:

```js
const brandSynonyms = new Set(['iphone', 'ipad', 'apple', 'macbook', 'airpods', 'watch',
                               'magsafe', 'belkin', 'anker', 'usb', 'lightning']);
```

Because in an all-Apple catalogue the word "apple" appears everywhere and therefore carries no
distinguishing information. Removing it makes the *product-type* words dominate the score.
This is a hand-rolled, domain-specific approximation of TF-IDF's intuition (rare words are
informative, common words are not).

Results are sorted by the statistically meaningful ranking:

```js
matchedProducts.sort((a, b) => {
  if (b.metrics.lift !== a.metrics.lift) return b.metrics.lift - a.metrics.lift;
  if (b.metrics.confidence !== a.metrics.confidence) return b.metrics.confidence - a.metrics.confidence;
  return b.metrics.support - a.metrics.support;
});
```

Lift first — correctly.

**The graceful fallback.** If the map is missing or nothing matches:

```js
const fallbackProducts = await prisma.product.findMany({
  where: { category: product.category, id: { not: productId }, quantity: { gt: 0 } },
  orderBy: { createdAt: "desc" },
  take: limit,
  select: { id: true, name: true, price: true, images: true, category: true, quantity: true },
});

return res.status(200).json({
  message: "Recommendations retrieved successfully",
  strategy: "category-fallback",
  ...
});
```

Note `quantity: { gt: 0 }` — never recommend something you cannot sell. And note the
`strategy` field in the response: the API tells the caller which path produced the answer.
That is excellent practice; it makes the feature debuggable from the outside.

**The state of this feature right now, stated plainly.** `backend/recommendation/output/` is
gitignored and does not exist in the working tree. `getRecommendationMap()` therefore throws
`ENOENT`, which is caught:

```js
try {
  recommendationMap = await getRecommendationMap();
} catch (error) {
  console.warn("Recommendation map not available, using fallback only:", error.message);
}
```

So **every recommendation request currently returns `strategy: "category-fallback"`**. The
Apriori path is fully implemented and fully unreachable until someone runs the trainer. The
same applies to the chatbot's "frequently bought together" prompt section, which silently
loads an empty object.

The `retrain` endpoint that would fix this has its own bug — see §8.6.

### 4.16 Notifications and transactional email

**Two channels, different guarantees.**

**In-app notifications** are rows in a table the user's browser polls:

```prisma
model Notification {
  id           String   @id @db.VarChar(24)
  userId       String   @db.VarChar(24)
  type         String
  title        String
  message      String
  read         Boolean  @default(false)
  productId    String?  @db.VarChar(24)
  productName  String?
  productImage String?
  createdAt    DateTime @default(now())

  @@index([userId, createdAt])
  @@map("notifications")
}
```

Four `type` values are produced in the code: `new_product`, `low_stock`, `discount`, and the
frontend's `Notification` interface also lists `order_update`.

`productName` and `productImage` are **denormalised copies** — the data already exists on the
`Product` row. Storing a copy means the notification list renders from one query with no
joins, and a historical notification still reads correctly after the product is renamed or
deleted. That is a legitimate use of denormalisation: preserving a point-in-time snapshot.

**Fan-out.** When a seller adds a product, every customer gets a notification:

```js
// backend/controller/productController.js — createProduct
try {
  const allUsers = await prisma.user.findMany({ where: { role: "user" }, select: { id: true } });
  if (allUsers.length > 0) {
    const notifDocs = allUsers.map((u) => ({
      id: generateId(), userId: u.id, type: "new_product",
      title: "🛒 New Product Added!",
      message: `${shopLabel} just added "${product.name}" — check it out!`,
      productId: product.id, productName: product.name,
      productImage: product.images?.[0] || null,
    }));
    await prisma.notification.createMany({ data: notifDocs });
  }
} catch (notifErr) {
  console.error("Notification fan-out error (non-fatal):", notifErr);
}
```

`createMany` is one bulk INSERT rather than N round-trips. Still: this is
**fan-out-on-write**, and it is O(number of users) per product. At 100,000 users, adding one
product writes 100,000 rows, synchronously, inside the HTTP request. The scalable alternative
is **fan-out-on-read** (store one "new product" event; each user's feed query joins against
it) or a background job queue. See §6.9.

Note also that the notification is created *before* the response is sent, so the seller waits
for it. Wrapping it in a queue would make product creation feel instant.

**Transactional email** — `backend/utils/emailService.js`:

```js
export const sendEmail = async (to, subject, text, html) => {
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const mailOptions = { from: process.env.EMAIL_USER, to, subject, text, html };

  try {
    console.log("Sending email to:", to);
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email (non-fatal):", error.message || error);
    // Do NOT throw — email failure should never crash the server or block the purchase flow
  }
};
```

**The design decision is in that last comment, and it is correct.** Email is a best-effort
side channel. If Gmail is down, the customer's *paid order* must still be confirmed. Swallowing
the error is the right call.

Every `sendEmail` call site also omits `await`:

```js
sendEmail(order.email, subject, text, html);
```

so the HTTP response is not delayed by SMTP latency. Combined with the internal try/catch,
this is a **fire-and-forget** side effect that cannot produce an unhandled rejection.

**What is given up.** No retries, no delivery tracking, no dead-letter queue. A transient SMTP
failure means that email is simply never sent, and nothing records that fact. For order
confirmations that is a genuine customer-service issue. A proper solution is a job queue with
retry and a transactional email provider (SendGrid, Postmark, SES) that reports bounces.
Gmail SMTP also has daily sending limits that make it unsuitable for production volume.

**Templates.** `order.js` contains a small email design system:

```js
const shopSphereEmail = (title, body, { accentColor = '#7c3aed', icon = '' } = {}) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;...">
  <div style="background:linear-gradient(135deg,${accentColor},${accentColor}dd);padding:28px 32px;...">
    <h1 style="...">${icon ? icon + ' ' : ''}${title}</h1>
  </div>
  <div style="padding:28px 32px;color:#374151;line-height:1.7;font-size:15px;">${body}</div>
  ...
</div>`;

const emailRow = (label, value, highlight = false) => `...`;
const emailTable = (rows) => `<table style="...">${rows}</table>`;
```

All styling is **inline** because email clients strip `<style>` blocks. That is why HTML email
looks like 2005 — it has to.

**A caution worth recording:** these templates interpolate values directly into HTML —
`${order.product?.name}`, `${reason || 'Not specified'}`. `reason` comes from user input on
the return-request endpoint. Interpolating unescaped user input into HTML is the classic
injection shape. The blast radius is limited (email clients heavily sandbox HTML and block
scripts) but escaping user-supplied values before interpolation would be correct hygiene.

### 4.17 Pagination

**The concept.** An endpoint that returns "all products" is fine with 20 products and fatal
with 200,000: the query is slow, the JSON is enormous, and the browser stalls parsing it.
Pagination returns a **page** at a time.

**The problem ShopSphere faced.** These endpoints already existed and already returned bare
arrays, and around forty frontend pages consumed them as arrays. Changing the response shape
to `{ items, total, page, pageSize }` would break every one of them — silently, because
`array.map` on an object throws only at runtime.

**The solution: opt-in pagination.** `backend/utils/pagination.js`:

```js
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
// Response shape stays a bare array unless the caller opts in via page/limit — several
// frontend pages still consume these endpoints as plain arrays (see README's Performance
// & Scalability notes), so switching the default shape would break them silently.
const UNPAGINATED_CAP = 1000;

export const parsePagination = (query = {}) => {
  const paginated = query.page !== undefined || query.limit !== undefined;
  if (!paginated) {
    return { paginated, prismaArgs: { take: UNPAGINATED_CAP } };
  }

  const rawPage = parseInt(query.page, 10);
  const rawLimit = parseInt(query.limit, 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Math.min(
    Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  return { paginated, page, pageSize, prismaArgs: { skip: (page - 1) * pageSize, take: pageSize } };
};
```

And the consuming pattern, identical in all four call sites:

```js
// backend/controller/productController.js — getProducts
const { paginated, page, pageSize, prismaArgs } = parsePagination(req.query);
const [products, total] = await Promise.all([
  prisma.product.findMany({ include: {...}, ...prismaArgs }),
  paginated ? prisma.product.count() : Promise.resolve(null),
]);

const enrichedProducts = products.map(formatProductResponse);

if (paginated) {
  return res.status(200).json({ items: enrichedProducts, total, page, pageSize });
}
res.status(200).json(enrichedProducts);
```

Points worth noting:

- **`Promise.all`** runs the row query and the count query concurrently rather than one after
  the other. Two round-trips in the time of one.
- **`paginated ? ... : Promise.resolve(null)`** — the `COUNT(*)` is skipped entirely when it
  is not needed, since it is a genuinely expensive query on a large table.
- **`MAX_PAGE_SIZE`** stops a client asking for `?limit=999999` and defeating the whole point.
- **`UNPAGINATED_CAP = 1000`** — even the legacy shape is no longer unbounded. Commit
  `7a5e79f` describes this as capping "the four previously unbounded list endpoints".

**The honest state of the feature.** No frontend page passes `page` or `limit` yet. So today
every call takes the legacy branch and gets up to 1,000 rows. The backend is ready; the
frontend has not adopted it. That is the definition of *partially implemented*, and §7 records
it as such.

> **Skip/take pagination has a known flaw worth knowing.** `skip: 100, take: 50` asks the
> database to find and discard 100 rows before returning 50 — cost grows with page number.
> And if a row is inserted while a user is paging, rows shift and an item can appear on two
> pages or on none. **Cursor-based pagination** ("give me 50 rows after id X") avoids both,
> at the cost of not supporting "jump to page 7". For an admin table, skip/take is fine; for
> an infinite-scrolling product feed, cursors are the better fit.
---

## 5. Data Flow and Runtime Scenarios

This section traces real user journeys end to end. For each step: what the user does, what the
frontend does, what the backend does, what the database does, what external services are
called, what comes back, and what the frontend does with it.

### 5.1 Scenario: a visitor browses the catalogue

**1. The user opens the site.**

The browser requests `/`. In a Docker deployment, nginx serves
`frontend/index.html` from `/usr/share/nginx/html`. The HTML loads `/src/main.tsx`
(development) or the hashed production bundle.

**2. The app boots.**

`frontend/src/main.tsx` runs. The bare `import './lib/session'` executes
`frontend/src/lib/session.ts`, which sets `axios.defaults.withCredentials = true` and
registers both interceptors. React then mounts `<App />`.

**3. The router picks a page.**

`frontend/src/App.tsx` matches `#/` to `<Route path="/" element={<Home />} />`. Because `Home`
is `lazy()`-loaded, React suspends, `<Suspense>` renders
`<LoadingState description="Loading ShopSphere…" />`, and the browser downloads the Home
chunk.

**4. `App.tsx`'s boot effect runs.**

```tsx
if (localStorage.getItem('token')) refreshSession();
```

For a first-time visitor there is no `token` hint, so nothing happens — no wasted request.

**5. `Home` fetches products.**

```tsx
// frontend/src/pages/Home.tsx
const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get`, {...});
```

`VITE_BACKEND_URL` comes from `frontend/.env` (`http://localhost:4000` in development).
The axios request interceptor runs but adds no `Authorization` header, since `accessToken` is
`null`.

**6. The request crosses origins.**

Frontend `:5173` calling backend `:4000` is cross-origin. Since this is a simple `GET` with no
custom headers, the browser sends it directly (no preflight) and checks the CORS response
headers afterwards.

**7. The backend middleware chain runs.**

In `backend/app.js` order: `cors` (origin `http://localhost:5173` matches
`/^http:\/\/localhost:\d+$/` → allowed) → security headers → `express.json()` (nothing to
parse on a GET) → `cookieParser()` → router matching. `/api/v1/product` routes to
`productRouter`, which matches `GET /get` → `getProducts`.

**Note there is no `verifyToken` on this route.** Browsing is public, by design.

**8. The controller queries the database.**

```js
// backend/controller/productController.js
export const getProducts = async (req, res) => {
  const { paginated, page, pageSize, prismaArgs } = parsePagination(req.query);
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      include: { seller: { select: SELLER_SELECT }, ...PRODUCT_FULL_INCLUDE },
      ...prismaArgs,
    }),
    paginated ? prisma.product.count() : Promise.resolve(null),
  ]);

  const enrichedProducts = products.map(formatProductResponse);

  if (paginated) {
    return res.status(200).json({ items: enrichedProducts, total, page, pageSize });
  }
  res.status(200).json(enrichedProducts);
};
```

with

```js
const PRODUCT_FULL_INCLUDE = { colorVariants: true, storageVariants: true, reviews: true };
const SELLER_SELECT = { shopName: true, phone: true, firstName: true, lastName: true };
```

**9. What the database actually does.**

`include` causes Prisma to fetch the related rows. `select` on the seller relation restricts
which seller columns come back — importantly, the seller's password hash and email are not in
that list. `parsePagination({})` (no query params) yields `{ take: 1000 }`.

**Performance note.** Every product's full review list is loaded on the listing page, but
`ProductCard` only uses `reviews.length` and the average rating. On a catalogue with many
reviews this transfers a lot of unused text. A `_count` aggregate plus a stored average would
be the efficient form. This is a concrete example of "preserve the old response shape during a
migration" costing performance later.

**10. The response shape is normalised.**

```js
export const formatProductResponse = (product) => {
  return {
    ...product,
    _id: product._id || product.id,
    category: product.category || "Uncategorized",
  };
};
```

**`_id` is added for backward compatibility.** MongoDB called the primary key `_id`; Prisma
calls it `id`. Dozens of frontend files still read `product._id`. Rather than editing all of
them, the backend ships both. `frontend/src/components/catalog/ProductCard.tsx` still declares
`_id: string` in its `CatalogProduct` type, and `backend/controller/productController.test.js`
locks the behaviour in:

```js
assert.deepEqual(response, {
  id: "66a200000000000000000003",
  _id: "66a200000000000000000003",
  name: "iPhone 16",
  ...
});
```

**11. The response comes back and renders.**

`Home` stores the array in `useState`, React re-renders, and each product becomes a
`ProductCard`. `getImageUrl()` rewrites any `http://localhost:4000` prefix in image URLs to
the configured backend base (§3.6).

**12. Two components mount alongside.**

`ChatWidget` renders its floating button (it makes no request until the user types).
`NotificationBell`, if present, checks `localStorage.token`; for a guest it is absent, so
`fetchNotifications` returns immediately.

**Summary of network traffic for a guest landing on the home page:** one HTML request, a
handful of JS/CSS chunks, one `GET /api/v1/product/get`, plus image requests. No
authentication, no cookies of consequence.

### 5.2 Scenario: registering, logging in, and staying logged in

#### 5.2.1 Registration

**1. The user fills the form** on `frontend/src/pages/UserAuth.tsx` (or `Auth.tsx`).

**2. The frontend calls the session module:**

```ts
// frontend/src/lib/session.ts
export const register = async (payload: Record<string, unknown>) => {
  const { data } = await axios.post(`${API_BASE}/api/v1/auth/register`, payload);
  setSession(data.accessToken, data.user);
  return data.user as SessionUser;
};
```

**3. This is a cross-origin POST with a JSON body, so the browser sends a preflight.**

> **Jargon: preflight.** Before a "non-simple" cross-origin request (any request with a JSON
> `Content-Type`, or a custom header, or a `PUT`/`DELETE`), the browser first sends an
> `OPTIONS` request asking the server whether the real request is permitted. The `cors`
> middleware answers it automatically. This is why `methods: ["GET", "POST", "PUT", "DELETE"]`
> in the CORS config matters — an unlisted method would be refused at preflight.

**4. Rate limiting.**

`credentialsLimiter` checks this IP's count in the last 15 minutes. Over 20 → `429 Too Many
Requests`, and the handler never runs.

**5. Validation.**

`registerSchema.safeParse(req.body)`. A password under 8 characters, a malformed email, or a
`role` outside the enum → `400 { code: "invalid_input", message }`.

**6. Business rules.**

```js
if (role === "seller" && !shopName) {
  return res.status(400).json({ code: "invalid_input", message: "Shop name is required for sellers" });
}
```

A conditional requirement zod cannot express as a flat object schema, so it is an explicit
check.

**7. Duplicate check.**

```js
const email = normalizeEmail(parsed.data.email);
const existingUser = await prisma.user.findUnique({ where: { email } });
if (existingUser) {
  return res.status(409).json({ code: "email_taken", message: "User already exists" });
}
```

`409 Conflict` — the right code for "this violates the current state of the resource".

**8. Hash the password.**

```js
password: await hashPassword(password),
```

Argon2id, ~19 MB of memory, deliberately slow. This is the slowest step in the whole request
and that is the point.

**9. Set verification state by role.**

```js
if (role === "seller") {
  userData.shopName = shopName;
  userData.shopDescription = shopDescription || "";
  userData.isVerified = false;
  userData.verificationRequestDate = new Date();
} else {
  userData.isVerified = true;
}
```

**10. Insert, with the race handled.**

```js
try {
  const user = await prisma.user.create({ data: userData });
  const accessToken = await issueSession(res, user);
  res.status(201).json({ user: toPublicUser(user), accessToken });
} catch (error) {
  if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
    return res.status(409).json({ code: "email_taken", message: "User already exists" });
  }
  console.error("Register error:", error.message);
  res.status(500).json({ code: "internal_error", message: "Server error" });
}
```

The `findUnique` in step 7 is a friendly early check; the `P2002` catch is the *correct* one.
Two simultaneous registrations with the same email both pass step 7; the unique index on
`users.email` lets only one insert succeed.

**11. `issueSession` creates the session.**

```js
const issueSession = async (res, user) => {
  const refreshToken = await issueRefreshFamily(user.id);
  setRefreshCookie(res, refreshToken);
  return signAccessToken({ id: user.id, role: user.role });
};
```

This inserts a `refresh_tokens` row (hash only, new `familyId`, 7-day expiry), sets the
httpOnly cookie, and returns a 15-minute JWT.

**12. Database writes for one registration:** one `users` INSERT, one `refresh_tokens` INSERT.

**13. Response.**

```json
{
  "user": { "id": "...", "email": "...", "role": "user", "admin": false,
            "seller": false, "sellerVerified": true },
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```
plus `Set-Cookie: refresh_token=…; HttpOnly; SameSite=Strict; Path=/api/v1/auth`.

**14. The frontend stores it.**

```ts
const setSession = (token: string, user: SessionUser) => {
  accessToken = token;     // module memory
  persistUiHints(user);    // localStorage sentinel + role flags
};
```

The JWT goes into a module variable. `localStorage` receives only the sentinel and UI hints.
The refresh cookie is stored by the browser and is invisible to JavaScript.

#### 5.2.2 Login

Same shape, with two differences.

**Verification:**

```js
const user = await prisma.user.findUnique({ where: { email } });
if (!user || !user.password) {
  return res.status(401).json({ code: "invalid_credentials", message: "Invalid email or password" });
}

const isMatch = await verifyPassword(user.password, password);
if (!isMatch) {
  return res.status(401).json({ code: "invalid_credentials", message: "Invalid email or password" });
}
```

**Both failures return the identical message.** That is deliberate. If "no such user" and
"wrong password" produced different responses, an attacker could enumerate which email
addresses have accounts — useful for targeted phishing. This is **username enumeration**
protection.

(`!user.password` covers Google-only accounts, which have no password to check.)

**Opportunistic rehash:** covered in §2.11.

#### 5.2.3 Google Sign-In

```js
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
const payload = ticket.getPayload();
const { sub: googleId, email, given_name: firstName, family_name: lastName } = payload;
```

**What is actually happening.** The browser talks to Google (via `@react-oauth/google`) and
receives an **ID token** — a JWT signed by *Google*. It sends that to ShopSphere.
`verifyIdToken` checks Google's signature against Google's published public keys, and checks
the `audience` matches this app's client id.

> **Why the `audience` check matters.** Without it, an attacker could take a valid Google ID
> token issued for *a completely different app* and present it here. The signature would be
> genuine; the token was simply never meant for ShopSphere. The audience claim is what binds
> a token to one application.

Account linking:

```js
let user = await prisma.user.findFirst({ where: { OR: [{ googleId }, { email: normalizedEmail }] } });

if (!user) {
  user = await prisma.user.create({ data: { id: generateId(), firstName: firstName || "User",
    lastName: lastName || "", email: normalizedEmail, googleId, role: "user", isVerified: true } });
} else if (!user.googleId) {
  user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
}
```

Match on `googleId` **or** email, so a user who registered with a password and later uses
Google with the same address gets their existing account linked rather than a duplicate.

New Google accounts are always `role: "user"` — you cannot become a seller or admin via Google
sign-in. Sensible: those roles require deliberate provisioning.

#### 5.2.4 Staying logged in: the refresh dance

**Fifteen minutes pass.** The user clicks something. The stored access token has expired.

```text
1. axios request interceptor attaches the (now expired) token
2. Backend `authenticate`: jwt.verify throws TokenExpiredError
                        -> 401 { code: "unauthenticated" }
3. axios response interceptor sees 401:
     - not an auth route
     - not already retried
     -> calls refreshSession()
4. refreshSession POSTs /api/v1/auth/refresh
     - no Authorization header needed
     - browser attaches refresh_token cookie automatically
       (path matches, SameSite allows it, withCredentials is on)
5. Backend `refresh`:
     - reads req.cookies.refresh_token
     - rotateRefreshToken(raw):
         hash it, look it up
         reject if missing / revoked / expired
         if usedAt is set -> revoke whole family, throw
         else mark usedAt, insert a NEW token in the same family
     - re-read the user (role may have changed since login)
     - set the new cookie, sign a new 15-minute access token
6. refreshSession stores the new token in module memory
7. Interceptor replays the ORIGINAL request with the new token
8. It succeeds. The user noticed nothing.
```

Two implementation details make this robust:

**Single-flight refresh.**

```ts
export const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/api/v1/auth/refresh`)
      .then(({ data }) => { setSession(data.accessToken, data.user); return data.accessToken as string; })
      .catch(() => { clearSession(); return null; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};
```

If a page fires six parallel requests that all 401, six calls to `refreshSession()` share one
in-flight promise. Without this, six concurrent rotations would race; the first would mark the
token used, and the other five would look like **reuse** and revoke the entire family —
logging the user out on every page that happens to load several resources at once.

**Role re-read on refresh.**

```js
const { userId, refreshToken } = await rotateRefreshToken(rawToken);
const user = await prisma.user.findUnique({ where: { id: userId } });
```

The new access token is signed from the *current* database role, not from the old token. So a
role change propagates within one refresh cycle — at most 15 minutes.

**On hard reload:** module memory is gone, so `App.tsx`'s effect calls `refreshSession()` and
the same dance restores the session from the cookie.

**Logout:**

```js
export const logout = async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawToken) await revokeFamilyByToken(rawToken);
  clearRefreshCookie(res);
  res.status(204).send();
};
```

Revokes the whole family server-side, so logging out on one device invalidates that session's
entire rotation chain. The access token remains technically valid until it expires (≤15 min) —
the unavoidable cost of stateless tokens, and the reason the TTL is short.

### 5.3 Scenario: adding an item to the cart

**1. The user clicks "Add to cart"** on `ProductDetailsPage.tsx` or a `ProductCard`.

**2. The frontend POSTs:**

```
POST /api/v1/cart/add
Authorization: Bearer <token>   (added by the interceptor)
{ "productId": "66a2...", "quantity": 1, "variants": { "color": "Black", "storage": "256GB" } }
```

**3. Backend:** `cartRouter.post("/add", verifyToken, addToCart)`. `verifyToken` populates
`req.user`.

**4. Validation:**

```js
const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive().optional(),
  variants: z.record(z.string()).optional(),
});
```

`z.record(z.string())` accepts any object whose values are strings — flexible enough for
arbitrary variant dimensions.

**5. Load user and product:**

```js
const user = await prisma.user.findUnique({ where: { id: req.user.id } });
if (!user) return res.status(404).json({ message: "User not found" });

const product = await prisma.product.findUnique({ where: { id: productId } });
if (!product) return res.status(404).json({ message: "Product not found" });
```

**Note what is *not* checked here: stock.** You can add an out-of-stock item to your cart. The
check happens at order creation. That is a deliberate and standard e-commerce choice — a cart
is an intention, not a reservation, and blocking the add would lose the signal that a customer
wants the item.

**6. Find or create the cart:**

```js
let cart = await prisma.cart.findFirst({ where: { email: user.email }, include: { items: true } });

if (!cart) {
  cart = await prisma.cart.create({
    data: { id: generateId(), userId: req.user.id, email: user.email,
      items: { create: [{ productId, quantity: quantity || 1, price: product.price,
                          variants: variants || {} }] } },
    include: { items: true },
  });
}
```

`items: { create: [...] }` is a **nested write**: Prisma issues the cart INSERT and the item
INSERT together.

**7. Or merge into the existing cart:**

```js
const existingItem = cart.items.find(
  (item) => item.productId === productId &&
            JSON.stringify(item.variants) === JSON.stringify(variants || {})
);

if (existingItem) {
  await prisma.cartItem.update({
    where: { id: existingItem.id },
    data: { quantity: existingItem.quantity + (quantity || 1) },
  });
} else {
  await prisma.cartItem.create({ data: { cartId: cart.id, productId, quantity: quantity || 1,
    price: product.price, variants: variants || {} } });
}
```

Adding the same product in a *different* colour creates a separate line — correct, since they
are different physical items. §4.5 covers the JSON-string comparison fragility.

**8. Recompute and persist the total:**

```js
const populatedCart = await getCartWithItems(user.email);
const { itemsWithDiscount, totalPrice, totalDiscount, finalPrice } = withDiscount(populatedCart.items);
await prisma.cart.update({ where: { id: populatedCart.id }, data: { totalPrice, updatedAt: new Date() } });
```

The comment on this line — `// Recalculate and persist totalPrice (was a Mongoose pre-save
hook)` — records a real migration consequence. Mongoose supported hooks that ran automatically
before every save. Prisma has no equivalent, so what was implicit became explicit, in four
different handlers. That is why the recomputation is inconsistent between them (§3.5): the
implicit hook could not drift, four hand-written copies can.

**9. Response and render.** The cart is returned with per-item discount fields; `Cart.tsx`
renders lines and `CartSummary.tsx` renders the totals.

**Database writes for one add-to-cart:** 1–2 SELECTs, one INSERT or UPDATE on `cart_items`,
one SELECT to repopulate, one UPDATE on `carts`. Four to five round-trips where a single
transaction with a computed total could do it in fewer. Fine at this scale; a place to
optimise later.

### 5.4 Scenario: checkout and payment (the critical path)

This is the most important flow in the application. It is traced in full.

#### The complete sequence

```text
 BROWSER                    SHOPSPHERE BACKEND               POSTGRES        eSewa
    │                              │                            │              │
    │ 1. POST /promo/apply         │                            │              │
    ├─────────────────────────────>│  insert PromoCodeUsage     │              │
    │                              ├───────────────────────────>│              │
    │                              │  increment usedCount       │              │
    │<─────────────────────────────┤                            │              │
    │                              │                            │              │
    │ 2. POST /order/createBulkOrder                            │              │
    ├─────────────────────────────>│  validate (zod)            │              │
    │                              │  per item: load product,   │              │
    │                              │    check stock, price it   │              │
    │                              │  INSERT orders (shared     │              │
    │                              │    orderGroupId)           │              │
    │                              ├───────────────────────────>│              │
    │                              │  INSERT revenues (Pending) │              │
    │                              ├───────────────────────────>│              │
    │<─── { order, orderGroupId, orderCount, totalAmount } ─────┤              │
    │                              │        NO STOCK DEDUCTED YET              │
    │                              │                            │              │
    │ 3. POST /payment/checkout    │                            │              │
    │    Idempotency-Key: <uuid>   │                            │              │
    ├─────────────────────────────>│  withIdempotency:          │              │
    │                              │   INSERT idempotency_keys  │              │
    │                              ├───────────────────────────>│              │
    │                              │   load order, check owner  │              │
    │                              │   check status == Pending  │              │
    │                              │   RECOMPUTE amount from DB │              │
    │                              │   HMAC-sign the fields     │              │
    │                              │   INSERT payments          │              │
    │                              │   INSERT payment_events    │              │
    │                              │     (intent_created)       │              │
    │                              ├───────────────────────────>│              │
    │<── { signature, transactionUuid, formActionUrl, ... } ────┤              │
    │                              │                            │              │
    │ 4. Build a hidden form, submit it                         │              │
    ├──────────────────────────────────────────────────────────────────────────>│
    │                              │                            │   user pays  │
    │                              │                            │              │
    │ 5. eSewa redirects the browser to                         │              │
    │    /api/v1/payment/esewa/success/:orderId?data=<base64>    │              │
    │<──────────────────────────────────────────────────────────────────────────┤
    ├─────────────────────────────>│                            │              │
    │                              │ 6. decode base64           │              │
    │                              │    verify HMAC signature   │              │
    │                              │       fail -> redirect to failure          │
    │                              │ 7. processEsewaEvent:      │              │
    │                              │    load payment by uuid    │              │
    │                              ├───────────────────────────>│              │
    │                              │    server-to-server status check ─────────>│
    │                              │<────────────── { status: COMPLETE, ref_id }┤
    │                              │    TX: INSERT payment_events (dedup key)   │
    │                              │        UPDATE payments -> Succeeded        │
    │                              ├───────────────────────────>│              │
    │                              │ 8. confirmOrderCore:       │              │
    │                              │    for each order in group │              │
    │                              │      TX: adjustStock(-qty) │              │
    │                              │          order -> Confirmed│              │
    │                              │          revenue -> Completed              │
    │                              ├───────────────────────────>│              │
    │                              │      low-stock alert if < 5│              │
    │                              │    send confirmation email │              │
    │                              │    clear the cart          │              │
    │<── HTML page that JS-redirects to #/success/:orderId ─────┤              │
    │                              │                            │              │
    │ 9. Success page loads        │                            │              │
    │    PUT /order/confirm/:id    │                            │              │
    ├─────────────────────────────>│  status is already Confirmed               │
    │                              │  -> alreadyConfirmed: true, no-op          │
    │<─────────────────────────────┤                            │              │
    │ 10. GET /order/getOrder      │                            │              │
    │     GET /order/details/:id   │                            │              │
    ├─────────────────────────────>│                            │              │
    │<──── order data, render receipt, offer PDF ───────────────┤              │
```

#### Step by step

**Step 1 — the promo code is consumed.**

`frontend/src/pages/CartCheckout.tsx` POSTs to `/api/v1/promo/apply` *before* creating the
order. §4.14 explains why this ordering is a design weakness.

**Step 2 — orders are created.**

```js
// backend/controller/order.js — createBulkOrderFromCart
const orderGroupId = crypto.randomUUID(); // Unique ID for this checkout session
```

**Why one `Order` row per cart item, rather than one order with many lines?** Because in a
marketplace, different items have different sellers, and each seller must independently
confirm, ship, and be paid for their own item. One row per item makes seller queries trivial
(`where: { productId: { in: sellerProductIds } }`) and lets each item advance through the
lifecycle at its own pace.

`orderGroupId` is the thread that ties them back together for payment and for the customer's
view. Note it is a UUID here, not a 24-hex id — it is not a primary key, just a grouping token.

Per item:

```js
const itemTotal = item.quantity * productDetails.price;
totalBeforeDiscount += itemTotal;
totalAmount += itemTotal;

const order = await prisma.order.create({
  data: { id: generateId(), firstName, lastName, email,
    productId: item.productId, quantity: item.quantity,
    deliveryDate: new Date(deliveryDate),
    deliveryStreet: deliveryAddress?.street, /* ...flattened address... */
    totalPrice: itemTotal,
    adminCommission: itemTotal * 0.05,
    userId,
    variantStorage: item.variants?.storage, variantColor: item.variants?.color, /* ... */
    orderGroupId, // Same for all orders in this checkout
    createdAt: new Date(),
  },
});
```

**Price is recomputed from `productDetails.price`, never from the request.** If the client
claims the iPhone costs Rs. 1, the server ignores it.

**The 5% commission is computed here**, server-side, and stored on the order — so a later
change to the rate does not retroactively rewrite historical orders.

A human-readable order number is derived:

```js
const generateOrderNumber = (id, date) => {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const suffix = id.slice(-6).toUpperCase();
  return `ORD-${year}${month}-${suffix}`;
};
```

`ORD-202608-A3F9B2`. Readable over the phone, unlike a 24-character hex string. It is derived
from the id, so it inherits its uniqueness.

A `Revenue` row is created per order with `status: "Pending"` — it becomes `"Completed"` only
at confirmation, which is why revenue reports filter on `status: "Completed"` and therefore
never count unpaid orders.

**Note on partial failure:** if a product id is invalid mid-loop, the code `continue`s and
skips it, but orders already created for previous items are **not** rolled back — there is no
transaction around the loop. A customer could end up with a partial order group. Insufficient
stock, by contrast, returns 400 immediately — also leaving earlier orders in the group already
created. Wrapping the loop in `prisma.$transaction` would fix both.

**Step 3 — the checkout endpoint signs the eSewa form.**

This is where the security of the payment lives:

```js
// backend/controller/payment.js
const { replayed, statusCode, body } = await withIdempotency(
  idempotencyKey,
  { userId, orderId },
  async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) { const err = new Error("Order not found"); err.statusCode = 404; throw err; }
    if (order.userId !== userId) {
      const err = new Error("Not authorized for this order"); err.statusCode = 403; throw err;
    }
    if (order.status !== "Pending") {
      const err = new Error(`Order cannot be paid — current status: ${order.status}`);
      err.statusCode = 400; throw err;
    }

    const orders = order.orderGroupId
      ? await tx.order.findMany({ where: { orderGroupId: order.orderGroupId } })
      : [order];

    const groupTotal = orders.reduce((sum, o) => sum + o.totalPrice, 0);
    const discount = order.orderGroupId
      ? orders.reduce((sum, o) => sum + (o.promoDiscountAmount || 0), 0)
      : 0;
    const totalAmount = Math.max(0, groupTotal - discount);

    const transactionUuid = crypto.randomUUID();
    const { signature, signedFieldNames, productCode } = signCheckoutFields({ totalAmount, transactionUuid });

    const payment = await tx.payment.create({
      data: { id: generateId(), orderId: order.id, orderGroupId: order.orderGroupId,
        transactionUuid, productCode, amount: totalAmount, status: "Initiated" },
    });

    await tx.paymentEvent.create({
      data: { id: generateId(), aggregateId: order.id, eventType: "intent_created",
        payload: { transactionUuid, amount: totalAmount, productCode, paymentId: payment.id } },
    });

    return { statusCode: 201, body: { success: true, paymentId: payment.id, transactionUuid,
      signature, signedFieldNames, productCode, amount: totalAmount, taxAmount: 0,
      totalAmount, formActionUrl: FORM_ACTION_URL } };
  }
);
```

Five guarantees in one function, each worth naming:

1. **Idempotency** — the whole body runs at most once per `Idempotency-Key`.
2. **Ownership** — 403 if the order is not yours.
3. **State** — 400 unless the order is still `Pending`, so an order cannot be paid twice.
4. **Server-computed amount** — read from the database, never from the request.
5. **Server-held secret** — `signCheckoutFields` uses `ESEWA_SECRET_KEY`, which exists only in
   the backend's environment.

The `Payment` row and the `intent_created` event are written inside the same transaction, so
either both exist or neither does.

**Step 4 — the browser posts to eSewa.**

```tsx
// frontend/src/pages/CartCheckout.tsx
const backendBase = (import.meta.env.VITE_BACKEND_URL as string).replace('/api', '');
const checkoutRes = await axios.post(`.../api/v1/payment/checkout`, { orderId },
  { headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": uuidv4() } });

const { transactionUuid, signature, signedFieldNames, productCode,
        amount, taxAmount, totalAmount, formActionUrl } = checkoutRes.data;

const form = document.createElement("form");
form.action = formActionUrl;
form.method = "POST";

const inputs = {
  amount: amount.toString(),
  tax_amount: taxAmount.toString(),
  product_service_charge: "0",
  product_delivery_charge: "0",
  total_amount: totalAmount.toString(),
  transaction_uuid: transactionUuid,
  product_code: productCode,
  success_url: `${backendBase}/api/v1/payment/esewa/success/${orderId}`,
  failure_url: `${backendBase}/api/v1/payment/esewa/failure/${orderId}`,
  signed_field_names: signedFieldNames,
  signature,
};

Object.entries(inputs).forEach(([key, value]) => {
  const input = document.createElement("input");
  input.type = "hidden"; input.name = key; input.value = value;
  form.appendChild(input);
});

document.body.appendChild(form);
form.submit();
document.body.removeChild(form);
```

**Why a real form submission rather than an `axios.post`?** Because the browser must
*navigate* to eSewa — the user has to see and interact with eSewa's own page. An AJAX POST
would fetch the HTML into JavaScript, which is useless (and would be blocked by CORS anyway).
Building and submitting a hidden form is the standard technique for a **redirect-style
gateway**.

**Critically, `success_url` and `failure_url` point at the BACKEND**, not the frontend. That is
the fix for the vulnerability described in `app.js`: the payment result must land somewhere
that can verify it. A frontend URL cannot verify anything.

**Step 5 & 6 — eSewa redirects back; the signature is checked.**

```js
export const esewaSuccessWebhook = async (req, res) => {
  try {
    const encoded = req.query.data;
    if (encoded) {
      const payload = decodeCallbackPayload(encoded);
      if (!verifyCallbackSignature(payload)) {
        console.error("eSewa callback signature mismatch", payload);
        return redirectToApp(req, res, "failure");
      }
      await processEsewaEvent(payload.transaction_uuid, { source: "success_redirect" });
    }
  } catch (error) {
    console.error("eSewa success webhook error:", error);
  }
  return redirectToApp(req, res, "success");
};
```

A failed signature check redirects to the failure page and processes nothing.

**Note the fall-through.** If `data` is absent, or if an exception is thrown, the user is still
redirected to the *success* page — but no `PaymentEvent` was written and the `Payment` stays
`Initiated`. So `PUT /order/confirm/:orderId` on the success page will return **402 Payment
Required**. The user sees a success page and then a "payment not verified yet" message. Not
ideal UX, but importantly **not a security hole**: the money-and-stock decision is gated on
the `Payment` row, not on which page the browser landed on.

**Step 7 — the authoritative verification.**

```js
export const processEsewaEvent = async (transactionUuid, { source } = {}) => {
  const payment = await prisma.payment.findUnique({ where: { transactionUuid } });
  if (!payment) return { ok: false, reason: "unknown_transaction" };
  if (payment.status !== "Initiated") return { ok: true, payment, alreadyProcessed: true };

  const statusResult = await checkTransactionStatus({
    productCode: payment.productCode,
    totalAmount: payment.amount,          // <-- OUR amount, from OUR database
    transactionUuid,
  });

  const newStatus = statusResult.status === "COMPLETE" ? "Succeeded" : "Failed";
  const gatewayEventId = `${transactionUuid}:${statusResult.status}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: { id: generateId(), aggregateId: payment.orderId,
          eventType: newStatus === "Succeeded" ? "charge_succeeded" : "charge_failed",
          payload: { transactionUuid, source: source || "callback", gatewayResponse: statusResult },
          gatewayEventId },
      });
      await tx.payment.update({
        where: { transactionUuid },
        data: { status: newStatus, gatewayRefId: statusResult.ref_id || null },
      });
    });
  } catch (err) {
    if (err.code === "P2002") {
      const fresh = await prisma.payment.findUnique({ where: { transactionUuid } });
      return { ok: true, payment: fresh, alreadyProcessed: true };
    }
    throw err;
  }

  if (newStatus === "Succeeded") {
    try {
      await confirmOrderCore(payment.orderId);
    } catch (confirmErr) {
      console.error("Post-payment order confirmation failed:", confirmErr);
    }
  }

  return { ok: true, payment: { ...payment, status: newStatus } };
};
```

The whole gateway response is stored in the event `payload`. If a payment is ever disputed,
there is a permanent record of exactly what eSewa said and when — in a table the application
cannot modify (§4.12.7).

`gatewayRefId` is eSewa's own reference number, the one a customer would quote to eSewa
support.

**Step 8 — the order is confirmed and stock is deducted.**

`confirmOrderCore` runs (§4.9). Per order: a transaction covering stock deduction, status
flip, and revenue completion. Then, outside the transaction:

```js
if (updatedProduct.quantity < 5) {
  // email the seller + create an in-app notification
}
```

**Deliberately outside the transaction.** Sending an email inside a database transaction would
hold the transaction open for the duration of an SMTP round-trip — holding locks, and risking
a duplicate email if the transaction retried. Side effects belong after the commit.

Then the consolidated confirmation email is sent to the customer, and the cart is cleared.
Both are wrapped in try/catch with explicit "don't fail the order" comments.

**Step 9 — the browser lands on the success page.**

The backend does not send an HTTP redirect. It sends a small HTML page:

```js
const redirectToApp = (req, res, outcome) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const { orderId } = req.params;
  const userAgent = req.headers["user-agent"] || "";
  const isCapacitor = userAgent.includes("Capacitor") || req.headers["x-capacitor"];
  const target = isCapacitor
    ? `capacitor://localhost/#/${outcome}/${orderId}`
    : `${frontendUrl}/#/${outcome}/${orderId}`;
  return res.send(
    `<!DOCTYPE html><html><head>...</head><body><p>Redirecting...</p>` +
    `<script>setTimeout(function(){ window.location.href = ${JSON.stringify(target)}; }, 300);</script>` +
    `</body></html>`
  );
};
```

**Why HTML-and-JavaScript rather than `res.redirect()`?** Two reasons. First, the target
contains a `#` fragment, and fragment handling across an HTTP redirect is inconsistent between
browsers. Second, the mobile case: `capacitor://localhost/...` is a custom scheme that a
standard HTTP redirect cannot reliably reach.

`JSON.stringify(target)` is used to embed the URL into the script — which correctly escapes
quotes and backslashes, preventing the interpolated value from breaking out of the string
literal.

**Step 10 — the success page reconciles.**

```tsx
// frontend/src/pages/Success.tsx
const updateOrder = async () => {
    if (updateOrderCalledRef.current) return;
    updateOrderCalledRef.current = true;

    try {
        try {
            const confirmResponse = await axios.put(
                `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/confirm/${orderId}`, {},
                { headers: { Authorization: `Bearer ${token}` } });
            toast.success("Confirmation email has been sent to your email address");
        } catch (confirmError) {
            console.error("Failed to confirm order and deduct stock:", confirmError);
            toast.error("Failed to confirm order and process stock");
        }

        const [orderRes, detailedOrderRes] = await Promise.all([
            axios.get(`${...}/api/v1/order/getOrder`, { headers: {...} }),
            axios.get(`${...}/api/v1/order/details/${orderId}`, { headers: {...} })
                 .catch(detailError => { console.error(...); return null; })
        ]);
        ...
```

**Why call confirm again when the webhook already did it?** **Belt and braces.** If the
webhook failed — network blip, eSewa slow, backend restart — the order would be stuck
`Pending` even though the customer paid. This second call is a self-healing retry. It is safe
*only* because `confirmOrderCore` is idempotent: in the normal case the status is already
`Confirmed`, so it returns `alreadyConfirmed: true` and changes nothing.

> **This is the single best illustration in the codebase of why idempotency is worth the
> effort.** It lets you retry freely, from multiple places, without coordination, without
> risking double stock deduction or a double confirmation email.

Then the page fetches order data (in parallel, with `Promise.all`), renders the receipt, and
offers a client-side PDF via `jsPDF`.

**A wrinkle worth flagging:** the success page finds its order with
`orderRes.data.find((o: Order) => o._id === orderId)`, but `GET /order/getOrder` returns rows
shaped by `withNestedOrderShape`, which preserves Prisma's `id` and does **not** add `_id`
(unlike products, which go through `formatProductResponse`). So `foundOrder` is likely
`undefined`, and the "Order ID / Product / Total" block does not render — while the
`orderDetails` block, fetched from `/order/details/:orderId`, does. Related to the `_id`
mismatch in §8.10.

**Failure path.** `esewaFailureWebhook` verifies the signature the same way, records a
`charge_failed` event if valid, and redirects to `#/failure/:orderId`. The order stays
`Pending`; no stock moves; the cart is untouched, so the customer can retry.

### 5.5 Scenario: a seller advances an order's status

**1. Seller opens `SellerOrders.tsx`** → `GET /api/v1/order/seller/my-orders`.

```js
const sellerProducts = await prisma.product.findMany({ where: { sellerId }, select: { id: true } });
const productIds = sellerProducts.map(p => p.id);

const orders = await prisma.order.findMany({
  where: { productId: { in: productIds } },
  include: { product: { select: { name: true, price: true, category: true } } },
  orderBy: { createdAt: "desc" },
});
```

**A two-query pattern with a scaling note.** Fetch the seller's product ids, then find orders
for those ids. With 5,000 products the `IN` list has 5,000 elements. A single query with a
relation filter — `where: { product: { sellerId } }` — would push the join into Postgres and
scale better. Also, unlike the four list endpoints, this one has **no pagination and no cap**.

**2. Seller clicks "Mark as Shipped"** → `PUT /api/v1/order/seller/update-status/:orderId`.

Guarded by `verifyToken, authorizeSeller`, then ownership inside:

```js
if (order.product.sellerId !== sellerId) {
  return res.status(403).json({ message: "You can only update orders for your own products" });
}

const validStatuses = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
if (!validStatuses.includes(status)) {
  return res.status(400).json({ message: "Invalid status" });
}

const data = { status };
if (status === "Confirmed")   data.confirmedAt  = order.confirmedAt  || new Date();
if (status === "Processing")  data.processingAt = order.processingAt || new Date();
if (status === "Shipped")     data.shippedAt    = order.shippedAt    || new Date();
if (status === "Delivered")   data.deliveredAt  = order.deliveredAt  || new Date();
```

**The `|| new Date()` pattern preserves the *first* time a state was entered.** Re-setting a
status does not overwrite the original timestamp — which matters because `deliveredAt` starts
the 7-day return clock. Without this, a seller could reset the status and silently restart the
return window.

**A gap worth noting:** `validStatuses` does not include `"Confirmed"`, yet the very next line
handles `status === "Confirmed"`. So that branch is unreachable through this endpoint — dead
code, and a sign the two lists drifted. More importantly, `validStatuses` is a **set**, not a
**state machine**: nothing stops a seller moving an order directly from `Pending` to
`Delivered`, or from `Delivered` back to `Processing`. Enforcing legal transitions (a map of
from→allowed-to) would be a genuine improvement.

**3. Email is sent** with a status-specific colour and icon:

```js
const statusColorMap = { Pending: '#f59e0b', Confirmed: '#3b82f6', Processing: '#8b5cf6',
                         Shipped: '#6366f1', Delivered: '#22c55e' };
const statusIconMap  = { Pending: '⏳', Confirmed: '✅', Processing: '⚙️',
                         Shipped: '🚚', Delivered: '📦' };
```

**4. The customer sees it** on `TrackOrder.tsx`, which calls `GET /api/v1/order/track/:orderId`:

```js
if (order.userId !== userId) {
  return res.status(403).json({ message: "Not authorized to track this order" });
}

const timeline = [
  { step: "Order Placed",  status: "Pending",    time: order.createdAt,    done: true },
  { step: "Confirmed",     status: "Confirmed",  time: order.confirmedAt,
    done: !!order.confirmedAt  || ["Confirmed","Processing","Shipped","Delivered"].includes(order.status) },
  { step: "Processing",    status: "Processing", time: order.processingAt,
    done: !!order.processingAt || ["Processing","Shipped","Delivered"].includes(order.status) },
  { step: "Shipped",       status: "Shipped",    time: order.shippedAt,
    done: !!order.shippedAt    || ["Shipped","Delivered"].includes(order.status) },
  { step: "Delivered",     status: "Delivered",  time: order.deliveredAt,
    done: !!order.deliveredAt  || order.status === "Delivered" },
];

res.status(200).json({ order: withNestedOrderShape(order), timeline });
```

The `done` logic is deliberately forgiving: a step counts as done if it has a timestamp **or**
if the current status is downstream of it. That means an order jumped straight to `Delivered`
still shows the earlier steps as complete, rather than a nonsensical half-empty timeline.
Handling messy real data gracefully rather than assuming it is perfect.

**Note `TrackOrder.tsx` uses raw `fetch()` with `localStorage.token`** — see §8.4.

### 5.6 Scenario: cancel, return, refund

#### Cancel (customer, before delivery)

```js
if (order.userId !== userId) return res.status(403).json({ message: "Not authorized to cancel this order" });

const cancellableStatuses = ["Pending", "Confirmed"];
if (!cancellableStatuses.includes(order.status)) {
  return res.status(400).json({
    message: `Order cannot be cancelled. Current status: ${order.status}. Only Pending or Confirmed orders can be cancelled.`,
  });
}

order = await prisma.$transaction(async (tx) => {
  await adjustStock(order.product.id, quantity, order.variantColor, order.variantStorage, 1, tx);
  return tx.order.update({ where: { id: orderId },
    data: { status: "Cancelled", cancelledAt: new Date() }, include: { product: true } });
});
```

**Subtle correctness point:** stock is restored unconditionally, including for `Pending`
orders — which never had stock deducted, because deduction happens at confirmation. So
cancelling a `Pending` order **increments stock that was never decremented**, inflating the
count by the order quantity.

Compare with `userDeleteOrder`, in the same file, which gets this right:

```js
const restoresStock = ['Confirmed', 'Processing', 'Shipped'].includes(order.status);
await prisma.$transaction(async (tx) => {
  if (restoresStock) {
    await adjustStock(order.product.id, order.quantity, order.variantColor, order.variantStorage, 1, tx);
  }
  await tx.order.delete({ where: { id } });
});
```

Two functions, same file, same concern, different answers. That is a real bug in `cancelOrder`,
recorded in §8.9.

Note also that cancellation does **not** update the `Revenue` row — it stays `Pending` if the
order was never confirmed, or `Completed` if it was. A cancelled-after-confirmation order
therefore still counts toward seller revenue. Only `releaseRefund` zeroes revenue.

#### Return request (customer, after delivery)

```js
if (order.status !== "Delivered") {
  return res.status(400).json({ message: "Return can only be requested for delivered orders" });
}

// Check 7-day window from deliveredAt (fallback to deliveryDate if deliveredAt missing)
const deliveredDate = order.deliveredAt || order.deliveryDate;
const daysSinceDelivery = (Date.now() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24);
if (daysSinceDelivery > 7) {
  return res.status(400).json({
    message: "Return window has expired. Returns are only accepted within 7 days of delivery.",
  });
}
```

The fallback matters: `deliveredAt` is only set if a seller explicitly marked the order
delivered. Older or hand-edited data may lack it, so `deliveryDate` (the *expected* delivery
date, set at order creation) is used instead. Defensive, and it prevents a `NaN` comparison
from silently allowing every return.

The route accepts an optional photo:

```js
orderRouter.put("/return/:orderId", verifyToken, upload.single("returnImage"), requestReturn);
```
```js
const returnImagePath = req.file ? req.file.filename : null;
```

Then **three** notifications go out — customer, admin (`process.env.ADMIN_EMAIL`), and the
seller — each wrapped so a failure is non-fatal.

#### Process return (admin or seller)

```js
orderRouter.put("/admin/return/:orderId", verifyToken, processReturn);
orderRouter.put("/seller/return/:orderId", verifyToken, authorizeSeller, processReturn);
```

One handler, two routes, with the role check inside:

```js
if (req.user.role === "seller") {
  const sellerId = req.user.id;
  if (!order.product || order.product.sellerId !== sellerId) {
    return res.status(403).json({ message: "Access denied. This order does not belong to you." });
  }
}
```

**Note the asymmetry:** the `/admin/return/:orderId` route has **no `authorizeAdmin`**. It is
guarded only by `verifyToken`. Since the in-handler check only applies when
`req.user.role === "seller"`, an ordinary **customer** can call the admin route and approve or
reject any order's return. Recorded in §8.9.

On approval, stock is restored — but here, outside any transaction:

```js
try {
  const { quantity } = order;
  await adjustStock(order.product.id, quantity, order.variantColor, order.variantStorage, 1);
} catch (stockErr) {
  console.error("Stock restore error on return approval:", stockErr);
}

// ... later ...
const updatedOrder = await prisma.order.update({ where: { id: orderId },
  data: { status: newStatus }, include: { product: true } });
```

Stock restore and status flip are separate, unwrapped operations — inconsistent with
`cancelOrder` and `confirmOrderCore`, which do wrap them. If the status update failed after
the stock restore, stock would be restored for an order still in `Return Requested`, which
could be approved again and restore stock a second time.

#### Release refund (admin)

```js
orderRouter.put("/admin/refund/:orderId", verifyToken, releaseRefund);
```

Also missing `authorizeAdmin`, and `releaseRefund` contains no role check of its own.

```js
if (order.status !== "Return Approved") {
  return res.status(400).json({
    message: `Refund can only be released for Return Approved orders. Current status: ${order.status}`,
  });
}

const updatedOrder = await prisma.order.update({ where: { id: orderId },
  data: { status: "Refund Released", refundReleasedAt: new Date() }, include: { product: true } });

// Mark revenue record as Refunded so it's excluded from all revenue totals
try {
  await updateFirstRevenueByOrder(order.id,
    { status: "Refunded", totalSalePrice: 0, adminCommission: 0, sellerRevenue: 0 });
} catch (revErr) {
  console.error("Revenue update error (non-fatal):", revErr);
}
```

**Two independent mechanisms exclude the refund from revenue** — the status changes to
`"Refunded"` (and every report filters `status: "Completed"`), *and* the amounts are zeroed.
Belt and braces on money.

**Important scope limitation, stated plainly:** this releases the refund **in ShopSphere's own
records only**. No call is made to eSewa. The customer email says the money "will be credited
to your original payment method within 5–7 business days", which implies a manual,
out-of-band refund. Anyone operating this system needs to know that.

### 5.7 Scenario: an admin approves a seller

**1. A seller registers.** `isVerified: false`, `verificationRequestDate` set.

**2. They try to add a product** and are stopped by the third middleware:

```js
productRouter.post("/create", verifyToken, authorizeSeller, checkSellerVerification, createProduct);
```

```js
if (!seller.isVerified) {
  return res.status(403).json({
    code: "forbidden",
    message: "Your account is pending admin verification. You cannot perform this action until approved.",
    sellerVerified: false,
  });
}
```

The extra `sellerVerified: false` field lets the frontend show a "pending approval" banner
rather than a generic error.

**3. Admin opens `AdminSellerApproval.tsx`** → `GET /api/v1/auth/unverified-sellers`
(`verifyToken, authorizeAdmin`):

```js
const unverifiedSellers = await prisma.user.findMany({
  where: { role: 'seller', isVerified: false },
  omit: { password: true },
});
```

> **Prisma's `omit`** returns every column *except* the listed ones. It is a deny-list, and
> the same caveat as §3.5 applies: a future sensitive column would be included by default.
> `select` (allow-list) is safer, though more verbose.

**4. Admin approves** → `PUT /api/v1/auth/verify-seller/:sellerId`:

```js
let seller = await prisma.user.findUnique({ where: { id: sellerId } });
if (!seller || seller.role !== 'seller') {
  return res.status(404).json({ code: "not_found", message: "Seller not found" });
}

seller = await prisma.user.update({
  where: { id: sellerId },
  data: { isVerified: true, verificationApprovedDate: new Date() },
});

await sendApprovalEmail(seller);
```

**5. The seller can now create products immediately.** No re-login needed — `isVerified` is
read from the database on every write, not from the JWT. This is the concrete payoff of the
design choice in §3.4.5.

**Rejection** records a reason and emails the seller, but leaves `isVerified` at `false`
(§3.5). Note also that `verifySeller` returns the full `seller` object — including the
password hash, since it does not use `omit` or `toPublicUser`. A small leak of a hash to an
admin's browser; not catastrophic, but avoidable.

**A `await` worth noticing:** `await sendApprovalEmail(seller)` blocks the response until the
email attempt finishes, unlike the fire-and-forget style used in `order.js`. The helper has
its own internal try/catch, so a failure will not 500 — but the admin waits for SMTP.

### 5.8 Scenario: a verified seller adds a product

**1.** Seller fills `AddProduct.tsx`, uploads images first:

```
POST /api/v1/product/uploadImage   (multipart, up to 3 files)
-> { imageUrls: ["http://localhost:4000/uploads/1724....jpg", ...] }
```

Server side:

```js
const imageUrls = req.files.map((file) =>
  `${req.protocol}://${req.get("host")}/uploads/${file.filename}`);
```

The absolute-URL problem that `getImageUrl()` later has to work around (§3.6).

**2.** Then creates the product:

```
POST /api/v1/product/create
{ name, price, description, quantity, images: [...], category,
  variants: { storage: [...], color: [...] },
  colorVariants: [{ color, images, stock }],
  storageVariants: [{ storage, stock }] }
```

Validated by `createProductSchema`, then:

```js
const product = await prisma.product.create({
  data: {
    id: generateId(), name, price: Number(price), description, quantity: Number(quantity),
    images, category,
    variantStorage: v.storage || [], variantColor: v.color || [], /* ... */
    sellerId: req.user.role === 'seller' ? req.user.id : null,
    colorVariants: { create: (colorVariants || []).map((cv) => ({
      color: cv.color, images: cv.images || [], stock: cv.stock || 0 })) },
    storageVariants: { create: (storageVariants || []).map((sv) => ({
      storage: sv.storage, stock: sv.stock || 0 })) },
  },
  include: PRODUCT_FULL_INCLUDE,
});
```

**`sellerId` comes from `req.user.id`, never from the body.** A seller cannot create a product
attributed to someone else. The nested `create` writes the product and all its variant rows in
one Prisma call.

**3.** Notification fan-out to every customer (§4.16), wrapped as non-fatal.

**4.** `201` with the full product; the seller is redirected to `SellerProducts.tsx`.

**5.** Every customer sees the notification within 30 seconds, when `NotificationBell` next
polls.

### 5.9 Scenario: a customer asks the chatbot a question

**1.** User opens `ChatWidget` and types "do you have the iPhone 17 in blue?".

**2.** The widget POSTs the message **and its own history**:

```tsx
const { data } = await axios.post(
  `${import.meta.env.VITE_BACKEND_URL}/api/v1/chat`,
  { message: text, history: updatedHistory },
);
```

Note: **no `Authorization` header is required** — `/api/v1/chat` has no `verifyToken`. And the
history lives in the browser, because the backend keeps no conversation state.

**3.** The backend checks configuration, then grounds the prompt in live data:

```js
if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === "your_groq_api_key_here") {
  return res.status(500).json({ reply: "Chatbot is not configured yet — API key missing. Please contact support." });
}

const products = await prisma.product.findMany({
  take: 60,
  select: { name: true, price: true, category: true, quantity: true,
            colorVariants: true, storageVariants: true },
});

const productContext = products.map(p => {
  const stockLabel = p.quantity === 0 ? "[Out of Stock]" : `[In Stock: ${p.quantity} units]`;
  let line = `- ${p.name} (${p.category}) — Rs. ${p.price.toLocaleString()} ${stockLabel}`;
  if (p.colorVariants?.length) {
    const colorStock = p.colorVariants
      .map(c => `${c.color}: ${c.stock > 0 ? c.stock + " units" : "OUT OF STOCK"}`).join(", ");
    line += ` | Colors: ${colorStock}`;
  }
  if (p.storageVariants?.length) { /* same for storage */ }
  return line;
}).join("\n");
```

**Comparing the placeholder value** (`=== "your_groq_api_key_here"`) is a nice touch — it
catches the common failure of copying `config.env.example` and forgetting to fill it in, and
gives a clear message instead of a confusing 401 from Groq.

**4.** System prompt = rules + FAQ + live catalogue + recommendation sample (§3.5). Note the
FAQ is read once at module load, so editing `faqs.json` requires a restart, while product data
is fetched per request and is always current.

**5.** History is trimmed and role-mapped:

```js
const chatHistory = history.filter((_, i) => i > 0).slice(-10).map(h => ({
  role: h.role === "bot" ? "assistant" : "user",
  content: h.content,
}));
```

The widget's `"bot"` becomes the API's `"assistant"`.

**6.** Groq is called:

```js
const completion = await groq.chat.completions.create({
  model: "llama-3.1-8b-instant",
  messages: [{ role: "system", content: systemPrompt }, ...chatHistory, { role: "user", content: message }],
  max_tokens: 300,
  temperature: 0.7,
});
```

`max_tokens: 300` caps the answer length (and the cost); `temperature: 0.7` allows moderate
variation — deterministic enough to follow the rules, varied enough not to sound robotic.

**7.** Errors degrade gracefully, including the 429-as-200 choice discussed in §3.5.

**8.** The widget appends the reply and re-renders.

**Two security observations.** The endpoint is unauthenticated and unrate-limited, so anyone
can consume the Groq quota. And every request sends up to 60 product rows including stock
levels to a third-party API — which is public information here, but is exactly the kind of
data flow worth being deliberate about before adding anything sensitive to the prompt.
---

## 6. Security and Architecture Decisions

Each decision below is presented the same way: **the problem**, **the options**, **what
ShopSphere chose**, **the trade-offs**, and **the effect on security, performance, or
maintainability**.

### 6.1 Why JWT access tokens instead of server-side sessions

**The problem.** HTTP is stateless. Every request must independently prove who the user is.

**The options.**

| | Server-side sessions | Stateless JWT |
|---|---|---|
| Server storage | One record per active session | None |
| Per-request cost | A lookup (memory/Redis/DB) | A signature verification (CPU only) |
| Revocation | Immediate | Impossible before expiry |
| Multi-instance | Needs a shared store | Works with no shared state |
| Payload visibility | Opaque id | Claims readable by anyone holding the token |

**What ShopSphere chose.** JWT access tokens, with a **15-minute** lifetime, plus a
server-side refresh token to compensate for the revocation weakness.

```js
// backend/utils/tokens.js
const ACCESS_TOKEN_TTL = "15m";
export const signAccessToken = ({ id, role }) =>
  jwt.sign({ sub: id, role, jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
```

**Why.** The 15-minute TTL is the entire argument. It converts "cannot revoke" into "revoked
within 15 minutes", which for a consumer marketplace is an acceptable bound. In exchange,
every authenticated request avoids a database round-trip, and the API can be scaled to N
instances behind a load balancer with **zero** shared session infrastructure.

**The trade-offs, stated honestly.**

- A compromised access token is valid for up to 15 minutes and cannot be killed.
- Role changes take up to 15 minutes to take effect for API authorization, because
  `authorizeAdmin` reads `req.user.role` from the token.
- The `jti` claim exists to enable a revocation blocklist, but nothing consults it — so that
  door is framed, not opened.

**The mitigation actually implemented.** `checkSellerVerification` deliberately breaks the
rule and reads the database, because seller approval is the one authorization fact that must
never be stale:

```js
const seller = await prisma.user.findUnique({ where: { id: req.user.id } });
if (!seller.isVerified) return res.status(403).json({ ... });
```

**Effect.** Security: bounded, quantified exposure rather than unbounded. Performance: no
session lookup on the hot path. Maintainability: no Redis to operate, no session store to
back up.

**What could be done differently.** Keep a small revocation list of `jti` values in Redis with
a 15-minute TTL, consulted by `authenticate`. That buys immediate revocation while keeping
almost all the statelessness benefit — the list is tiny, because entries expire as fast as the
tokens do.

### 6.2 Why rotating refresh-token families

**The problem.** Refresh tokens are long-lived (7 days) bearer credentials. If one is stolen,
the attacker has a week of access, and — worse — you have no way to know it happened.

**The options.**

1. **Static refresh token.** Simple. A theft is undetectable and lasts until expiry.
2. **Rotation without detection.** Each use issues a new token. A theft is short-lived but
   still undetected, and the legitimate user just gets mysteriously logged out.
3. **Rotation with reuse detection and family revocation.** As above, plus: any reuse of a
   spent token is treated as evidence of compromise and kills every token in that login's
   chain.

**What ShopSphere chose.** Option 3 (`backend/utils/refreshTokenStore.js`, §4.6).

**Why the detection works at all.** Under rotation, a well-behaved client *never* presents the
same refresh token twice — it always holds the newest one. So a second presentation is
anomalous by construction. That is not true without rotation, where reuse is normal and
indistinguishable from theft.

**The trade-offs.**

- **False positives are possible.** A client that races two refreshes, or a user who restores
  a browser profile from backup, will trip the detector and be logged out. The frontend guards
  the common case with the single-flight `refreshPromise` (§5.2.4), but the risk is real.
- Rotation writes a new row on every refresh, so `refresh_tokens` grows. There is **no cleanup
  job** in this repo — expired rows are rejected at use time but never deleted. On a busy
  system that table grows without bound. A periodic
  `DELETE FROM refresh_tokens WHERE expiresAt < now()` is the missing piece.
- Each refresh costs a database read plus two writes.

**Effect.** Security: a stolen refresh token is detectable and its use terminates the whole
session — a genuinely strong property that most hand-rolled auth systems lack. Performance:
negligible, since refreshes happen at most every 15 minutes per user. Maintainability: the
logic is 60 lines in one file with a dedicated test.

### 6.3 Why Argon2id with a bcrypt read path

**The problem.** Passwords must be hashed with a deliberately slow algorithm. The project
already had users hashed with bcrypt.

**The options.**

1. Keep bcrypt. No migration, but stays on the older algorithm.
2. Switch to Argon2id and force every existing user to reset their password. Clean, hostile to
   users, and guarantees churn.
3. Switch to Argon2id, keep a bcrypt verification path, and upgrade each user silently when
   they next log in.

**What ShopSphere chose.** Option 3 (§2.11).

**Why it is safe.** `isLegacyHash` reads the algorithm from the hash string itself
(`$argon2` prefix vs `$2a$`), so no schema change and no per-user flag was needed. The rehash
happens at the only moment the server legitimately holds the plaintext — immediately after a
successful verification.

**The trade-offs.**

- Two hashing libraries must remain installed while any legacy hash survives.
- A user who never logs in again keeps a bcrypt hash forever. Acceptable: bcrypt is not broken.
- `seedAdmin.js` still creates bcrypt hashes, so the bootstrap admin starts legacy and
  upgrades on first login.

**Effect.** Security: strictly improved, with no user-visible disruption. Maintainability: one
small file (`password.js`) contains the entire dual-algorithm concern; the rest of the codebase
calls `hashPassword`/`verifyPassword` and is unaware the migration exists.

### 6.4 Why the access token lives in memory, not localStorage

**The problem.** The SPA needs the access token on every request. Where does it live between
requests?

**The options.**

| Location | XSS-readable? | Survives reload? | CSRF-exposed? |
|---|---|---|---|
| `localStorage` | Yes, trivially | Yes | No |
| `sessionStorage` | Yes, trivially | Per-tab only | No |
| A normal cookie | Yes (JS-readable) | Yes | Yes |
| An httpOnly cookie | No | Yes | Yes (needs SameSite/CSRF token) |
| Module memory | Only by code running in-page | **No** | No |

**What ShopSphere chose.** A **hybrid**, and the split is the clever part:

- **Access token → module memory** (`let accessToken` in `frontend/src/lib/session.ts`).
- **Refresh token → httpOnly cookie**, scoped to `path=/api/v1/auth`, `SameSite=strict`.

**Why this specific pairing.** It targets each threat with the mechanism that actually
addresses it:

- The access token, used on every request, is the one XSS would most want. Memory is not a
  documented, greppable key an injected script reads in one line.
- The refresh token, needed across reloads, is httpOnly — invisible to JavaScript entirely.
- The refresh cookie *is* CSRF-shaped, so it gets `SameSite=strict` **and** a path scope so
  narrow that it is never even sent to the endpoints an attacker would target.
- Losing the access token on reload is not a problem, because `App.tsx` immediately trades the
  cookie for a fresh one.

**The trade-offs.**

- An extra `/auth/refresh` round-trip on every hard reload.
- Module memory is not a security boundary: script injected into the same page can still reach
  a lot. It raises the bar; it does not eliminate XSS risk.
- **The unfinished part** — `localStorage` still holds `token: "session"`, `isAdmin`, and
  `isSeller` as UI hints, and forty pages read them. The code says so explicitly and names the
  upgrade path (a `useSession()` hook). Until that lands, the frontend has two parallel notions
  of "logged in".

**Effect.** Security: meaningfully better than the common `localStorage` JWT. Maintainability:
one module owns auth entirely, so pages just call `axios` — but the leftover `localStorage`
hints are technical debt that will bite whoever tries to add proper route guards.

### 6.5 Why separate frontend and backend at all

**The problem.** Should the server render HTML pages, or serve JSON to a client-side app?

**The options.**

1. **Server-rendered** (Express + a template engine). One deployable, great SEO, simple auth
   with cookies. Every interaction is a full page load.
2. **SPA + REST API** (this repo). Two deployables, app-like interactivity, one API serving
   web and mobile alike. Worse SEO by default, more moving parts, must handle CORS and token
   auth.
3. **Full-stack framework** (Next.js, Remix). Server rendering *and* client interactivity, at
   the cost of a heavier framework and a coupled deployment.

**What ShopSphere chose.** Option 2.

**Why, given this repo's specifics.** The Capacitor traces throughout the codebase are the
strongest clue: `base: './'` in `vite.config.ts`, `capacitor://localhost` in the CORS
allow-list and in `redirectToApp`, and on-screen-keyboard handling in `App.tsx`. A mobile app
cannot consume server-rendered HTML; it needs an API. Once you need an API for mobile, having
the web frontend use the same API is strictly simpler than maintaining two paths.

**The trade-offs.**

- **SEO.** `HashRouter` plus client rendering means a crawler sees an empty shell. For a
  storefront that wants its product pages found, this is a genuine cost.
- Two deployables, two `package.json`, two CI jobs.
- CORS, token handling, and a loading state on every page — all complexity a server-rendered
  app would not have.
- **Duplicated validation**: the checkout form is validated in `CartCheckout.tsx` and again by
  zod in `order.js`. Unavoidable and correct (client for UX, server for safety), but it is
  duplication.

**Effect.** Security: forces a clean trust boundary — the split makes it obvious that the
client cannot be trusted, which is a *good* effect. Performance: fast in-app navigation, slower
first paint. Maintainability: clear separation of concerns; more infrastructure.

### 6.6 Why a CORS allow-list function instead of a static origin

**The problem.** The browser must be told which origins may read API responses. Development
uses several ports and LAN IPs; production uses one domain; mobile uses a custom scheme.

**The options.**

1. `origin: "*"` — allows everything. **Illegal with `credentials: true`**, and would defeat
   the purpose.
2. `origin: process.env.FRONTEND_URL` — one origin. Breaks LAN testing and Capacitor.
3. A function evaluating each origin against rules (this repo).

**What ShopSphere chose.** Option 3 (§4.13).

**The trade-offs.**

- The private-range regexes (`/^http:\/\/192\.168\./`, `/^http:\/\/10\./`,
  `/^http:\/\/172\./`) are **unanchored and broad**, and they are active in production. They
  should be gated on `NODE_ENV !== "production"`.
- A rejected origin produces a thrown `Error` rather than a clean 403, which surfaces to the
  browser as an opaque CORS failure — hard to debug from the client side.

**Effect.** Security: much better than a wildcard, weaker than it should be in production
because of the development conveniences left in. Maintainability: adding an origin is a
one-line change in a readable list.

### 6.7 Why the middleware order in `app.js` is what it is

**The problem.** Express runs middleware in registration order. The order determines both
correctness and security.

**The order, and why each position is right:**

```js
app.use(cors({...}));            // 1
app.use(securityHeaders);        // 2
app.use(express.json());         // 3
app.use(express.urlencoded());   // 4
app.use(cookieParser());         // 5
app.use('/api/v1/auth', authRouter);   // 6 ...routers
app.use("/uploads", express.static(...)); // 7
app.use(errorMiddleware);        // 8 (last)
```

**1. CORS first.** A CORS preflight is an `OPTIONS` request that must be answered before
anything else looks at the request. Registering `cors` after the routers would mean preflights
fall through to a 404 and every cross-origin POST fails.

**2. Security headers second.** They must be set before any handler can send a response.
Anything that responds early — including a CORS rejection — should still carry them.

**3–4. Body parsers before routers.** Handlers read `req.body`. If `express.json()` ran after
the routers, `req.body` would be `undefined` in every handler and every zod schema would
reject. This is the single most common Express ordering mistake.

**5. `cookieParser` before routers.** Same reason, for `req.cookies`.

**6. Routers.** By now the request has been vetted (origin), decorated (headers), and parsed
(body, cookies).

**7. Static uploads.** Position is not critical, but note it is *after* the API routers, so a
route path can never be shadowed by a file on disk.

**8. Error middleware last.** Express only sends an error to a four-argument handler registered
*after* the thing that failed. Registering it first would make it invisible.

**Within a route, the order matters just as much:**

```js
productRouter.post("/create", verifyToken, authorizeSeller, checkSellerVerification, createProduct);
```

`verifyToken` **must** come first, because `authorizeSeller` reads `req.user.role` — which
does not exist until `verifyToken` sets it. Reversing them would throw
`TypeError: Cannot read properties of undefined`. And `checkSellerVerification` performs a
database read, so it is deliberately placed **last** among the guards: the two cheap in-memory
checks reject the overwhelming majority of bad requests before the expensive one runs.

> **The general principle: order guards cheapest-first and dependency-respecting.** Free checks
> before paid ones; producers before consumers.

The exact same logic is why `cartRoute.js` is uniformly `verifyToken` and why
`userManagementRoute.js` uses `router.use(verifyToken, authorizeAdmin)` — applying guards once
at the router level makes it impossible to forget them on a new route.

### 6.8 Why stock is deducted after payment, not at order creation

Covered mechanically in §4.9. As a decision:

**The problem.** When does a unit stop being available to other customers?

**The options.**

| Approach | Overselling | Denial-of-inventory | Extra machinery |
|---|---|---|---|
| Deduct at order creation | Impossible | **Trivial** — abandoned checkouts destroy availability | A reaper job to release stale orders |
| Deduct at payment confirmation | **Possible** in the payment window | Impossible | None |
| Reserve at creation, commit at payment | Impossible | Bounded by reservation TTL | Reservation table + expiry job |

**What ShopSphere chose.** Deduct at payment confirmation, stated in a code comment at the
exact site.

**The trade-off, named.** It trades a rare, recoverable failure (oversell → refund one
customer) for the elimination of a common, hard-to-detect one (inventory silently
disappearing into abandoned carts). Given a small catalogue and modest traffic, that is a
sound call.

**What makes it *more* defensible here.** Confirmation is gated on a verified payment, and
`confirmOrderCore` is idempotent — so the deduction happens exactly once, at a moment when a
real sale is certain.

**What would make it fully safe.** A conditional decrement — for example
`UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1` — so
confirmation fails cleanly when stock ran out, rather than going negative.

### 6.9 Scalability: what scales, what does not, and why that is fine for now

**What scales well:**

| Property | Why |
|---|---|
| Stateless API | No session store; add instances freely behind a load balancer |
| JWT auth | No shared state needed for authentication |
| Idempotency via a DB constraint | Correct across N instances, unlike an in-memory lock |
| Payment event dedup via a unique index | Same reasoning |
| Promo one-per-user via a composite PK | Same reasoning |
| Targeted indexes | `Order(email, createdAt)`, `Notification(userId, createdAt)`, `Revenue(sellerId, year, month)`, `PaymentEvent(aggregateId, createdAt)`, `PromoCode(code, isActive)` |
| Route-level code splitting | First paint does not download the admin dashboard |
| Opt-in pagination + a 1,000-row cap | Bounded response sizes |

> **Notice the pattern.** Every concurrency-safety mechanism in this codebase is a **database
> constraint**, never an application lock. That is exactly what makes horizontal scaling
> possible: an in-memory mutex protects one process; a unique index protects the system.

**What does not scale, in rough order of when it will hurt:**

1. **Notification fan-out is O(users) per event.** `createProduct` inserts one row per
   customer, synchronously, inside the request. At 100,000 users, adding a product writes
   100,000 rows while the seller waits. `notifyPromoCode` and `setProductDiscount` do the same.
   *Fix:* a job queue, or fan-out-on-read.

2. **Revenue reports sum in JavaScript.** Every matching row is loaded into Node before being
   reduced. *Fix:* `prisma.aggregate` / `groupBy` — the indexes for it already exist.

3. **`express-rate-limit` uses an in-memory store.** Per-instance counters mean the effective
   limit multiplies by the number of instances. *Fix:* a Redis store.

4. **Uploads are on local disk.** Two instances have two disks. *Fix:* S3-compatible object
   storage plus a CDN.

5. **`getSellerOrders` fetches all product ids, then all orders, unpaginated.** *Fix:* a
   relation filter plus pagination.

6. **The product list loads every product's full review list.** *Fix:* `_count` plus a stored
   average rating.

7. **Recommendation cache is per-process.** Harmless here; the pattern is dangerous for
   authoritative data.

8. **The idempotency prune runs on every checkout.** A `DELETE` on the hot path.

9. **`refresh_tokens` grows without bound** — no cleanup job.

10. **Migrations run on every backend container start.** N replicas race on deploy.

**Why none of this is wrong today.** This is a project serving a small catalogue for a regional
market. Every item above is a *known* limit with a *known* fix, and none of them requires an
architectural rewrite — they are all replaceable pieces behind stable interfaces. **Premature
optimisation would have cost time and added operational complexity (Redis, a queue, object
storage, a CDN) for load that does not exist.** The important thing is that the *concurrency
correctness* work — which genuinely is hard to retrofit — was done early and done at the
database level.

### 6.10 Why PostgreSQL replaced MongoDB

**The problem.** The project started on MongoDB and migrated to PostgreSQL mid-development —
an expensive, disruptive change nobody undertakes casually.

**What the code tells us about why.** Look at what the relational schema now provides that the
document model did not:

- **Foreign keys.** `Order.productId` references `Product.id`. The database refuses an order
  for a product that does not exist. Under MongoDB, nothing prevented a dangling reference.
- **Unique constraints as concurrency primitives.** `IdempotencyKey.key`,
  `PaymentEvent.gatewayEventId`, `PromoCodeUsage`'s composite key, `User.email`,
  `Payment.transactionUuid`, `Order.orderNumber`, `PromoCode.code`, `Bill.billNumber`. Every
  one of these is doing real safety work in this codebase (§4.10, §4.12.5, §4.14).
- **Multi-document transactions that are natural rather than exotic.** MongoDB supports them,
  but only on a replica set and with caveats; in Postgres they are the default tool.
- **Column-level permissions.** `REVOKE UPDATE, DELETE ON payment_events` has no clean MongoDB
  equivalent.
- **Real joins.** `include: { product: { include: { seller: ... } } }` in one query, instead of
  application-side lookups or `$lookup` gymnastics.

> **The general lesson.** Document databases are excellent when data is genuinely
> document-shaped and access patterns are known: a product with embedded variants really is
> one document. But an e-commerce system's core is **relationships and invariants** — orders
> reference products which reference sellers; money must not be double-counted; a promo must
> be used once. Those are precisely the guarantees relational databases exist to provide.

**The trade-offs paid.**

- A one-time ETL script (437 lines) and a period of running both.
- Embedded arrays became child tables (`ProductColorVariant`, `CartItem`, `ProductReview`),
  which changed every response shape — hence `withNestedOrderShape` and `formatProductResponse`
  reassembling the old JSON.
- Mongoose's implicit hooks (`pre('save')`) had to become explicit code, which is why cart
  total recalculation is duplicated and inconsistent (§3.5, §5.3).
- Some Mongo-era modelling survived: email-keyed cart lookups, no unique index on
  `Revenue.orderId`, denormalised `Cart.email`, and the three-way variant representation.

**Effect.** Security and correctness: substantially improved — most of the concurrency
guarantees in this document are only possible because of it. Performance: better for the
relational access patterns this app actually has. Maintainability: better long-term, at the
cost of one hard migration and a residue of transitional shims.

### 6.11 Why idempotency is enforced at the database, not in the application

**The problem.** Ensure a checkout runs exactly once per key, correctly, even with concurrent
duplicate requests and multiple server instances.

**The options.**

1. **An in-memory `Set` or `Map` of seen keys.** Fast; **wrong** with more than one instance,
   and lost on restart.
2. **A distributed lock (Redis `SETNX`).** Works; introduces a new critical dependency, and
   lock expiry/renewal is its own subtle problem.
3. **A unique database constraint plus catching the violation.** No new infrastructure; the
   database's existing locking does the work.

**What ShopSphere chose.** Option 3 (§4.10), and the comment explains precisely why it is
sufficient:

```js
// Concurrent requests with the same key race on the idempotency_keys unique constraint:
// Postgres blocks the second INSERT until the first transaction commits, then rejects it
// with 23505 (Prisma P2002) — that block *is* the row lock the spec asks for, no manual
// SELECT ... FOR UPDATE needed.
```

**Why this is the strongest available guarantee.** Any check-then-act in application code has
a window between the check and the act. The database's unique index has no such window: the
check and the act are the same operation, inside the same lock.

**The trade-offs.** Errors become control flow (catching `P2002` as a normal outcome), which
reads oddly until you understand it. And it couples correctness to a PostgreSQL behaviour —
though it is standard SQL behaviour, not a Postgres quirk.

**Effect.** Security: a customer cannot be double-charged by a retry. Performance: one extra
INSERT per checkout. Maintainability: no Redis, no lock lifecycle to reason about — arguably
*simpler* than the alternatives, not just cheaper.

### 6.12 Why the payment ledger is append-only, enforced by database privileges

**The problem.** The payment audit trail is the record you rely on when a customer disputes a
charge. It is worthless if it can be altered.

**The options.**

1. A comment saying "do not update this table". Advisory only.
2. A code-level convention — no `update` calls on that model. Better; still just discipline.
3. A database `REVOKE` so the application's role physically lacks the privilege.
4. An external append-only store or WORM storage. Strongest; heavy.

**What ShopSphere chose.** Option 3:

```sql
REVOKE UPDATE, DELETE ON payment_events FROM shopsphere;
```

**Why it matters.** This defends against threats that a code convention cannot: a *bug* that
issues an update, a *future developer* who does not know the rule, and an *attacker* who
achieves code execution in the application. In every case, PostgreSQL refuses.

**The trade-offs.**

- The role name is hardcoded, so a different `DATABASE_URL` user needs the migration edited —
  the comment says so.
- If the app connects as the table owner or a superuser, the `REVOKE` has no effect, because
  owners keep their privileges. Deployments should use a dedicated non-owner role.
- The table grows forever, by design. Archival is a future concern.
- Fixing genuinely bad data requires a privileged connection — which is the point, but it does
  mean an operational procedure exists.

**Effect.** Security: the highest-integrity data in the system is protected by a mechanism
independent of application code. Maintainability: four lines of SQL and one comment.

### 6.13 Why the eSewa form is signed server-side

**The problem.** eSewa requires an HMAC signature over the amount and transaction id. Someone
must compute it with the shared secret.

**The options.**

1. **Sign in the browser.** Requires shipping the secret to the client. **Catastrophic**: the
   secret is then public, and anyone can sign a payment for any amount.
2. **Sign on the server, with the amount supplied by the client.** Secret is safe, but the
   client controls the amount — so it can pay Rs. 1 for a Rs. 190,000 phone, with a valid
   signature.
3. **Sign on the server, with the amount recomputed from the database.** Secret safe, amount
   authoritative.

**What ShopSphere chose.** Option 3:

```js
const groupTotal = orders.reduce((sum, o) => sum + o.totalPrice, 0);
const discount = order.orderGroupId ? orders.reduce((sum, o) => sum + (o.promoDiscountAmount || 0), 0) : 0;
const totalAmount = Math.max(0, groupTotal - discount);

const { signature, signedFieldNames, productCode } = signCheckoutFields({ totalAmount, transactionUuid });
```

and the comment above `checkout` states the intent:

```js
// Computes the charge amount from the order in the DB (never trusts a client-supplied amount)
// and signs the eSewa form fields server-side, so the signing secret never reaches the browser
// and the amount can't be tampered with client-side.
```

**Important caveat, for honesty.** Option 1 — signing in the browser with a hardcoded secret —
**still exists in this repository**, in `frontend/src/pages/PaymentForm.tsx`:

```tsx
const hash = CryptoJS.HmacSHA256(message, "8gBm/:&EnhH.1/q");
```

It is routed at `/payment` but nothing navigates there (§8.3). The value is eSewa's published
sandbox key, so nothing real is exposed today — but the *shape* is the vulnerable one, and it
should be deleted rather than left as a template for someone to copy.

**Effect.** Security: the amount charged is the amount owed, provably. Performance: one extra
round-trip before redirecting to eSewa. Maintainability: all payment logic in one place.

### 6.14 Maintainability decisions

Four choices in this codebase are specifically about being able to change it later.

**a) Dependency injection with a default.**

```js
export const adjustStock = async (productId, quantity, selectedColor, selectedStorage, sign, client = prisma) => {
export const updateFirstRevenueByOrder = async (orderId, data, client = prisma) => {
export const issueRefreshFamily = (userId, client = prisma) =>
export const rotateRefreshToken = async (rawToken, client = prisma) => {
export const bootstrapAdmin = async ({ client, email, password }) => {
export const initializeDatabase = async ({ client = prisma, demoEnabled, seedDefaultAdmin, seedDemo } = {}) => {
```

One parameter serves two purposes: threading a `$transaction` handle in production, and
injecting a fake in tests. The whole backend test suite runs with no database as a direct
result. **Effect:** CI needs no service container; tests are fast and deterministic.

**b) Deliberate backward compatibility during migration.**

`formatProductResponse` adds `_id` alongside `id`. `withNestedOrderShape` reassembles the flat
address and variant columns into the nested objects the frontend expects:

```js
const withNestedOrderShape = (order) => {
  if (!order) return order;
  const { deliveryStreet, deliveryCity, deliveryState, deliveryZipCode, deliveryCountry,
          variantStorage, variantColor, variantRam, variantScreenSize, variantProcessor,
          promoCode, promoDiscountAmount, ...rest } = order;
  return {
    ...rest,
    deliveryAddress: { street: deliveryStreet, city: deliveryCity, state: deliveryState,
                       zipCode: deliveryZipCode, country: deliveryCountry },
    variants: { storage: variantStorage, color: variantColor, ram: variantRam,
                screenSize: variantScreenSize, processor: variantProcessor },
    promoCode: promoCode ? { code: promoCode, discountAmount: promoDiscountAmount } : undefined,
  };
};
```

**Effect:** the database could be swapped without touching the frontend. **Cost:** a permanent
translation layer, and a response shape that no longer reflects the schema. It should
eventually be retired by updating the frontend — otherwise every new developer must learn two
shapes.

**c) Opt-in pagination.** Adding a feature without breaking any caller (§4.17). **Effect:** the
backend improvement could ship independently of frontend work.

**d) Comments that record *why*.** This codebase is unusually good at this, and the comments
are doing real work:

```js
// Stock will be deducted AFTER payment confirmation, not immediately
// This prevents stock reduction if payment is cancelled
```
```js
// createOrder() already bakes any promo discount into totalPrice; createBulkOrder()
// only stores it on promoDiscountAmount, so it's only subtracted here for the grouped/bulk
// case — subtracting it for both would double-discount single orders.
```
```js
// Same raw token presented twice: it was already rotated once, so this is
// either a replay or the token was stolen. Kill the whole family.
```
```js
// Do NOT throw — email failure should never crash the server or block the purchase flow
```
```js
// ponytail: hand-rolled instead of pulling in helmet for a handful of static headers.
```

**Effect:** a future maintainer can tell the difference between a deliberate decision and an
accident — which is exactly the information that is otherwise lost, and exactly what stops
someone "fixing" a subtlety back into a bug.

**The counterweight, stated fairly.** Some comments have gone stale and now assert things the
code no longer does — see §8.5 for the `generateBill` case. A wrong comment is worse than no
comment.

---

## 7. Development Plan and Roadmap

There is no `ROADMAP.md`, no day-by-day plan, and no issue tracker in this repository. The
`docs/` directory is empty. What *does* exist is the commit history and the old README's
feature classification. Both are used here, with the code checked against them.

### 7.1 What the commit history shows about the build order

```
e5710b9  Initial commit
6921803  feat: set up Express backend with Prisma ORM and PostgreSQL
a512adf  add product, cart, order, promo code, and revenue APIs
50641bc  feat: overhaul authentication with refresh tokens and password hashing
8f4affd  feat: add eSewa payment integration with idempotent ledger
461e005  Added Readme
b06701e  Added Readme
39904f6  Fix ReferenceError...; transactions; zod validation; Bill upsert; security headers; caps
7a5e79f  Remove unused dependency; more zod; opt-in pagination; CI; Dockerfiles; unit tests
```

Read as phases:

1. **Skeleton** — Express + Prisma + Postgres.
2. **Features** — the CRUD surface for products, cart, orders, promos, revenue.
3. **Security overhaul** — refresh-token families, Argon2id. Notably, this *replaced* an
   earlier auth implementation rather than adding to it, which is why deleted files like
   `AUTHENTICATION_UPDATE.md` exist in history.
4. **Payments** — eSewa, idempotency, the append-only ledger.
5. **Hardening** — transactions around money and stock, validation, pagination, CI, Docker,
   tests.

The migration from MongoDB is not a separate commit subject, but its artefacts —
`backend/models/`, `backend/scripts/migrateMongoToPostgres.js`, and the ObjectId-shaped ids —
place it at or before phase 1.

**The order is worth noticing.** Security and payment correctness came *after* features but
*before* scaling and polish. That is a defensible sequence for a project of this kind: build
enough to know what you are building, then make the parts that handle money and identity
correct, then make it operable.

### 7.2 What is built and working

Verified present in code:

- Email/password auth with Argon2id, bcrypt legacy verification and silent upgrade
- Rotating refresh-token families with reuse detection and family revocation
- Google Sign-In with server-side ID-token verification
- Three roles with middleware guards, plus per-resource ownership checks on most endpoints
- Seller verification workflow with approval/rejection emails
- Product CRUD with per-colour and per-storage stock, image upload, reviews, discounts
- Server-side persistent cart with live discount computation
- Single-item and multi-item (grouped) order creation
- eSewa checkout: server-side HMAC signing, signature-verified callback, authoritative
  status check, append-only event ledger, idempotent checkout endpoint
- Full order lifecycle including cancel, return request with photo, return approval/rejection,
  and refund release (in ShopSphere's records)
- Order tracking timeline
- Promo codes with usage limits, per-user usage, min-purchase and max-discount rules
- Revenue reporting (monthly and total) for sellers and admins, 5% commission
- In-app notifications with 30-second polling
- Transactional email across the order lifecycle
- Groq-backed chatbot grounded in live product and stock data
- Bill generation, persisted idempotently, with a client-side PDF receipt
- Backend and frontend test suites, and CI running both
- Docker Compose for all three services

### 7.3 What is partially implemented

**Pagination.** The helper, the four endpoints, and the tests all exist. **No frontend page
passes `page` or `limit`.** So every list call currently takes the legacy branch and returns
up to 1,000 rows. Backend done; frontend adoption outstanding.

**Validation.** zod covers auth, orders, cart, product creation, and promo codes.
`revenueController.js` and `userManagement.js` still use lighter manual checks. Deliberate
prioritisation — money and content first.

**Recommendations.** The Python trainer, the fuzzy matcher, the cache, the ranking, and the
fallback are all implemented. But `backend/recommendation/output/` does not exist, so
`strategy` is always `"category-fallback"`, and the retrain endpoint has a filename bug
(§8.6). The feature is written but not switched on.

**Reviews.** `addProductReview` and `getProductReviews` work, and the `ProductReview` model has
an `orderId` column — the hook for "verified purchase" reviews. But nothing checks that the
reviewer actually bought the product; `userId` and `userName` come from the request body
rather than from `req.user`. So a logged-in user can post a review as any name, for any
product. The schema anticipates the feature; the enforcement is not there.

**Bills.** `generateBill` persists a `Bill` row via a deterministic upsert. But `getUserBills`
still constructs bills in memory from `Order` rows and never reads the `bills` table. The two
halves disagree about where a bill lives.

**Mobile / Capacitor.** Configuration and code paths exist throughout (`base: './'`, CORS
origins, `capacitor://` redirect, keyboard handling), but no Capacitor config or native project
is committed.

### 7.4 What is explicitly not implemented, and why

From the old README plus code inspection:

**CSRF tokens.** The reasoning given: the refresh cookie is `SameSite=strict`, which modern
browsers refuse to send cross-site, and authenticated API calls use an `Authorization` header
that a cross-site form cannot set. A CSRF token would be defence-in-depth, not a missing lock.
*Reasonable, with the caveat that `SameSite` is a browser-enforced control — old or unusual
clients are outside it.*

**A shared rate-limiter store.** `express-rate-limit`'s in-memory default does not survive
horizontal scaling. Fixing it means adding Redis. Deferred because there is currently one
instance.

**An access-token blocklist.** The `jti` claim is minted but unused. Deferred because a
15-minute TTL bounds the exposure and a blocklist reintroduces the per-request lookup that JWTs
were chosen to avoid.

**Real refunds through eSewa.** `releaseRefund` updates ShopSphere's records and emails the
customer; no gateway call is made.

**Wishlists.** No model, no endpoint, no page. Never started.

**Search beyond name and category.** `searchProducts` supports `type=name` and `type=category`
with `contains` matching. No full-text search, no faceting, no relevance ranking, no price or
rating filters.

**A lint gate in CI.** Explicitly deferred — the frontend has pre-existing ESLint findings that
would fail every build.

**Object storage for uploads.** Local disk, with a Docker volume.

**A background job queue.** Everything — emails, notification fan-out, idempotency pruning —
runs inline in the request.

### 7.5 How the architecture supports what comes next

The useful question is not "what is missing" but "how expensive is each addition?" Grouped by
cost:

**Cheap, because the seams already exist:**

| Feature | Why it is easy |
|---|---|
| Turning pagination on | Backend done; add `?page=&limit=` and read `{items,total}` in the UI |
| Enabling recommendations | Run the trainer, fix the dataset filename (§8.6) |
| Verified-purchase reviews | `ProductReview.orderId` exists; add an ownership query and take `userId` from `req.user` |
| Redis rate limiting | `express-rate-limit` accepts a store; one config change |
| More zod coverage | The pattern is established in five controllers |
| A `refresh_tokens` cleanup job | One indexed `DELETE` |
| Locking down the endpoints in §8.9 | Adding `authorizeAdmin` and ownership checks |
| A revoked-`jti` blocklist | `jti` is already in every token |

**Moderate:**

| Feature | What it touches |
|---|---|
| A job queue for email and fan-out | New dependency + worker process; `sendEmail` and the fan-out sites are already isolated |
| S3 uploads | Replace multer's storage engine and the URL construction; delete `getImageUrl` |
| Aggregate revenue queries | Rewrite four controller functions; indexes already exist |
| Wishlists | A new model, router, controller, page — but the pattern is repeated eight times already |
| A second payment gateway | `utils/esewa.js` is already an isolated adapter; `Payment`/`PaymentEvent` are gateway-agnostic apart from `productCode` |
| Real eSewa refunds | Add a gateway call plus new event types to the existing ledger |

**Expensive, because they cut across the model:**

| Feature | Why it is hard |
|---|---|
| True combination SKUs | Redesign the variant model, migrate data, rewrite stock checks and `adjustStock`, rebuild the product form (§4.3) |
| Server-authoritative promo discounts | Change the order-creation contract and the frontend flow (§4.14) |
| Server-side rendering / SEO | `HashRouter` → `BrowserRouter`, a rendering server, revisit auth for SSR |
| Reserve-then-commit inventory | New reservation table, expiry job, and changes to every stock path |
| Multi-currency | Prices are `Float` with `Rs.` hardcoded in components and email templates |

**One general observation.** The parts that are hardest to change later — the identifier
scheme, the concurrency-safety mechanisms, the payment ledger, the transaction boundaries
around money — are the parts that got the most care. The parts that are cheap to change later
— pagination adoption, notification delivery, image hosting — are the ones deferred. That is
the right way round, and it is the strongest signal of architectural judgement in this
repository.
---

## 8. Errors, Pitfalls, and Lessons Learned

Some of what follows is history — problems that were found and fixed, recoverable from commit
messages and from comments the fixes left behind. The rest are issues **still present in the
working tree**, found by reading the code for this document. Each is labelled so you know
which is which.

### 8.1 The MongoDB → PostgreSQL migration

**Status: completed.**

#### Problem

The project was built on MongoDB with Mongoose. Partway through, it moved to PostgreSQL with
Prisma. Every model, every query, and every response shape was affected — while a working
application already existed and clients already held ids and tokens.

#### Why it happened

MongoDB is a natural first choice: no schema to design up front, documents map neatly onto
JavaScript objects, and `Product` with embedded `colorVariants` genuinely is document-shaped.

But an e-commerce core is not document-shaped. It is a web of relationships and invariants:

- An order must reference a product that exists.
- A promo code must be usable once per customer, even under concurrent requests.
- A payment must not be processed twice, even if the gateway sends the callback twice.
- Stock deduction, order status, and revenue must all change or none of them.

Every one of those is a constraint, and constraints are what relational databases are for.
Trying to enforce them in application code is possible and fragile; every check-then-act has a
race window.

#### How it was diagnosed

Not a single incident. The evidence in the repo is of accumulated pressure: the schema is full
of unique constraints that are load-bearing for concurrency, the payment layer leans on
`P2002` in three separate places, and `REVOKE UPDATE, DELETE` has no clean Mongo equivalent.
The migration enabled the safety mechanisms, not the other way round.

#### Fix

Six coordinated moves:

1. **Model the relational schema** — `backend/prisma/schema.prisma`, 16 models, with embedded
   arrays promoted to child tables and embedded objects flattened to columns.
2. **Preserve every id verbatim** — `backend/scripts/migrateMongoToPostgres.js` copies each
   Mongo `_id` hex string into the Postgres primary key:

```js
const id = (v) => (v ? v.toString() : null);
...
await prisma.user.create({ data: { id: id(d._id), firstName: d.firstName, ... } });
```

   and `generateId()` makes new ids the same shape. The schema comment records why.
3. **Preserve response shapes** — `formatProductResponse` re-adds `_id`;
   `withNestedOrderShape` rebuilds `deliveryAddress` and `variants` as nested objects.
4. **Replace implicit Mongoose behaviour with explicit code** — pre-save hooks became explicit
   recalculation; Mongoose validators became zod schemas.
5. **Preserve quirks deliberately, with tests** — `updateFirstRevenueByOrder` mirrors
   `findOneAndUpdate`'s "first match only" semantics, and `order.test.js` asserts that the
   second matching row is untouched.
6. **Keep the old layer for the ETL only** — `backend/models/` and `mongoose`/`mongodb` remain
   installed but are imported by nothing except the migration script.

#### Lesson

**Change one thing at a time.** The migration changed the *storage engine* and nothing else.
Response shapes stayed identical, ids stayed identical, and even a debatable behaviour
(updating only the first matching revenue row) was preserved rather than "improved" in flight.
That is what made it possible to verify: if something broke, it was the migration, not a
simultaneous redesign.

**And: choose the database for the constraints you need, not the data shape you have.** The
data was document-shaped. The *invariants* were relational. Invariants won.

### 8.2 The unverified payment redirect

**Status: fixed. The vulnerability and its fix are both documented in `backend/app.js`.**

#### Problem

The original flow told eSewa to redirect the browser straight to the frontend on success. The
frontend then treated arriving at `#/success/:orderId` as proof of payment, and called the
confirm endpoint, which deducted stock and completed the order.

**So an attacker could type the success URL into the address bar and receive goods without
paying.**

#### Why it happened

A very natural mistake, and an extremely common one. The reasoning goes: eSewa redirects here
only after a successful payment, so being here means payment succeeded.

The flaw is that **the redirect is delivered by the customer's browser**, which is entirely
under the customer's control. It is not a message from eSewa to the server. It is a message
from eSewa to the *user*, which the user then hands to the server — and the user can hand the
server anything they like.

Compounding it, the frontend was the component making the trust decision, and the frontend is
the least trustworthy component in the system.

#### How it was diagnosed

The comment left behind in `backend/app.js` describes the state of affairs precisely enough
that it reads like the note written while fixing it:

```js
// eSewa redirects the browser here after payment. These used to redirect straight to the
// frontend with zero server-side verification (the frontend then trusted the redirect alone
// and deducted stock). Real verification now lives in paymentRouter's /esewa/success|failure
// routes; kept here only as aliases in case an old client build still points at these paths.
```

#### Fix

Four layers, all shipped in commit `8f4affd`:

1. **Point the callbacks at the backend.** `success_url` and `failure_url` now target
   `/api/v1/payment/esewa/success/:orderId`, a route that can verify.
2. **Verify the HMAC signature** on the callback payload before touching anything:

```js
const payload = decodeCallbackPayload(encoded);
if (!verifyCallbackSignature(payload)) {
  console.error("eSewa callback signature mismatch", payload);
  return redirectToApp(req, res, "failure");
}
```

3. **Confirm out-of-band with eSewa**, sending our own stored amount:

```js
const statusResult = await checkTransactionStatus({
  productCode: payment.productCode,
  totalAmount: payment.amount,     // from OUR database
  transactionUuid,
});
const newStatus = statusResult.status === "COMPLETE" ? "Succeeded" : "Failed";
```

4. **Gate confirmation on the resulting `Payment` row**, so even a direct call to the confirm
   endpoint cannot succeed without a verified payment:

```js
if (payment && payment.status !== "Succeeded") {
  return res.status(402).json({ message: "Payment not verified yet. Please wait a moment and try again." });
}
```

The old frontend-facing URLs were kept as redirect aliases, so an old cached client build gets
routed into the verified path rather than breaking.

#### Lesson

**Never trust a payment result that arrived via the user's browser.** A redirect is a hint
that something happened; it is not evidence of what happened. Evidence comes from a
server-to-server call to the party that actually knows.

**And: the trust decision must live on the server.** The original design had the *frontend*
decide the order was paid. The frontend can decide what to display; it must never decide what
is true.

### 8.3 A leftover client-side payment page with a hardcoded secret

**Status: still present in the working tree.**

#### Problem

`frontend/src/pages/PaymentForm.tsx` is the pre-fix payment page. It contains:

```tsx
const message = `total_amount=${totalAmount},transaction_uuid=${uuid},product_code=EPAYTEST`;
const hash = CryptoJS.HmacSHA256(message, "8gBm/:&EnhH.1/q");
const hashBase64 = CryptoJS.enc.Base64.stringify(hash);
setSignature(hashBase64);
```

and posts a form whose callbacks point straight back at the frontend:

```tsx
<input type="hidden" name="success_url" value={`${window.location.origin}/#/success/${orderId}`} />
<input type="hidden" name="failure_url" value={`${window.location.origin}/#/failure/${orderId}`} />
```

That is exactly the design §8.2 removed: the signing secret in the browser, the amount taken
from a query parameter, and the result reported to the frontend with no server verification.

`frontend/src/App.tsx` still routes it:

```tsx
<Route path="/payment" element={<PaymentForm />} />
```

#### Why it happened

The fix replaced the *flow*. Nothing navigates to `PaymentForm` any more —
`BuyProduct.tsx` and `CartCheckout.tsx` both call `/api/v1/payment/checkout` and build their
own form. Nobody deleted the old page or its route.

#### How it was diagnosed

By searching the frontend for who navigates to `/payment`:

```
grep -rn "navigate(\"/payment\|navigate('/payment\|to=\"/payment" frontend/src
```

which returns nothing, while `payment/checkout` appears in exactly two files —
`BuyProduct.tsx` and `CartCheckout.tsx`.

#### Fix (recommended; not yet applied)

Delete `frontend/src/pages/PaymentForm.tsx`, its `lazy()` import, and its `<Route>`. Then
`crypto-js` and `uuid` can likely be reviewed as dependencies — though `uuid` is still used for
`Idempotency-Key` generation, so check before removing.

**How bad is it today?** `8gBm/:&EnhH.1/q` is eSewa's *published sandbox* secret — the same
value is in `backend/config/config.env.example`. So no real credential is exposed. But this
page is dead code shaped exactly like the vulnerability that was already fixed once, sitting on
a live route where anyone can find it and copy it.

#### Lesson

**Deleting the old path is part of the fix.** A vulnerability that has been "fixed" by writing
a new path, while the old path remains reachable, has been *bypassed*, not fixed. Dead code
carrying a security anti-pattern is worse than dead code, because someone will eventually treat
it as an example.

### 8.4 Pages that use raw `fetch()` never send a real token

**Status: still present in the working tree.**

#### Problem

Six frontend files call the API with `fetch()` instead of `axios`, and pass an `Authorization`
header built from `localStorage`:

- `frontend/src/components/NotificationBell.tsx`
- `frontend/src/pages/MyOrders.tsx`
- `frontend/src/pages/AdminOrders.tsx`
- `frontend/src/pages/OrderDetails.tsx`
- `frontend/src/pages/Profile.tsx`
- `frontend/src/pages/UserDetails.tsx`

For example:

```tsx
// frontend/src/pages/MyOrders.tsx
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/user/get`, {
  method: "GET",
  headers,
});
```

where `token` is `localStorage.getItem("token")`.

Since the auth overhaul, that value is the literal string `"session"` (§4.7). So the request
sends `Authorization: Bearer session`. The backend runs `verifyAccessToken("session")`,
`jwt.verify` throws, and the endpoint returns **401**.

And because `fetch` is not `axios`, **the response interceptor never runs** — so there is no
automatic refresh and no retry. The request simply fails.

`frontend/src/pages/TrackOrder.tsx` has the same shape:

```tsx
const token = localStorage.getItem("token");
if (!token) { navigate("/auth"); return; }
try {
  const res = await fetch(
    `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/track/${orderId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
```

#### Why it happened

The auth overhaul (`50641bc`) moved the real token into module memory and made axios attach it
automatically. That change is invisible to any code path that does not go through axios. The
migration updated the axios pages implicitly — they needed no edit at all — and silently
skipped every `fetch` page.

The `localStorage.token = "session"` sentinel made it worse: the pages still find a truthy
`token` and proceed confidently, rather than failing an early "am I logged in?" check.

Note that on axios pages, code like this is also present:

```tsx
const confirmResponse = await axios.put(url, {}, { headers: { Authorization: `Bearer ${token}` } });
```

Those work — but only because the request interceptor **overwrites** the header with the real
token. The explicit header is dead weight that happens to be harmless.

#### How it was diagnosed

Grep for files that call `fetch(` in the frontend, then check what value they put in the
`Authorization` header, then trace that value back to `persistUiHints` in `session.ts`.

#### Fix (recommended; not yet applied)

Convert the six files to `axios` and drop the manual header entirely, letting the interceptors
do their job:

```tsx
const { data } = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/user/get`);
```

The lower-effort alternative — export `getAccessToken()` (which `session.ts` already provides)
and use it in the `fetch` calls — restores authentication but still misses the automatic
refresh-and-retry, so those pages would break every 15 minutes.

#### Lesson

**A cross-cutting concern is only cross-cutting if everything goes through the same door.**
The interceptor design is excellent — right up to the point where six files use a different
HTTP client and quietly opt out of all of it. Making the shared module the *only* way to reach
the API (a `lib/api.ts` wrapper, or an ESLint rule banning bare `fetch`) is what turns a
convention into a guarantee.

**And: a placeholder that looks like a real value is a trap.** `token: "session"` was a
pragmatic shim, but it made broken calls look plausible. A name like
`ui_logged_in: "1"` would have made the mistake obvious at the call site.

### 8.5 Stale comments that now describe the opposite of the code

**Status: still present in the working tree.**

#### Problem

`backend/controller/order.js` carries this comment directly above `generateBill`:

```js
// Generate bill for an order
// NOTE: Bill is built and returned in-memory only — the old code never called Bill.create()
// (the Mongo Bill collection was effectively unused), so this doesn't touch prisma.bill either.
export const generateBill = async (req, res) => {
```

Immediately below it, the function does exactly what the comment says it does not:

```js
const billNumber = `BILL-${orderId}`;

const persisted = await prisma.bill.upsert({
  where: { billNumber },
  update: {},
  create: { id: generateId(), billNumber, orderId: order.id, userId: order.user?.id, ... },
});

if (!order.billId) {
  await prisma.order.update({ where: { id: order.id }, data: { billId: persisted.id } });
}
```

`getUserBills` has the same stale note, but there it is still **accurate** — that function
really does build bills in memory from `Order` rows and never reads `prisma.bill`.

Separately, `backend/middlewares/error.js` contains a branch that cannot work:

```js
if (err.name === 'ValidationError') {
  const validationErrors = Object.values(error.errors).map(err => err.message);
  return next(new ErrorHandler(validationErrors.join(', '), 400));
}
```

The parameter is `err`; `error` is undefined in that scope. If this branch ever executed it
would throw `ReferenceError: error is not defined`. It is currently unreachable, because
`ValidationError` is a Mongoose error name and Mongoose is no longer in the request path.

#### Why it happened

Commit `39904f6` added the `Bill` upsert — the message says "Persist Bill rows via idempotent
upsert (was rebuilt in-memory only on every request, Bill table was otherwise unused)". The
code changed; the comment above it did not.

The `error.js` branch is Mongoose-era code carried through the migration untouched, because it
never runs and so never fails.

#### How it was diagnosed

By reading the function body after reading its comment — which is the only way stale comments
are ever found, and the reason they are dangerous.

#### Fix (recommended)

Delete the stale sentence above `generateBill`. Delete both Mongoose branches from
`error.js` (or rewrite them for Prisma's `P2002`/`P2025` codes, which would actually be
useful). And reconcile `getUserBills` to read from the `bills` table now that rows exist.

#### Lesson

**A comment that contradicts the code is worse than no comment**, because a reader who trusts
it will reason from a false premise — here, "bills are never persisted", which would lead
someone to add a second persistence path and produce duplicates.

Comments explaining *why* age well; comments describing *what* the code does age badly, because
only the code is checked by anything. This codebase's best comments are all "why" comments —
and the one that went stale is a "what" comment.

### 8.6 The retrain endpoint points at a file that does not exist

**Status: still present in the working tree.**

#### Problem

`retrainProductRecommendations` in `backend/controller/productController.js` builds this path:

```js
const datasetPath = path.resolve(
  recommendationDir,
  "data/Final_Apple_Apriori_Dataset.csv"
);
...
await fs.access(scriptPath);
await fs.access(datasetPath);
```

The file actually present is `backend/recommendation/data/Final_Apple_Apriori_Dataset_v2.csv`
— note the `_v2`. So `fs.access(datasetPath)` throws `ENOENT`, the catch block runs, and the
endpoint returns:

```json
{ "message": "Failed to retrain recommendation model", "error": "ENOENT: no such file or directory, ..." }
```

Combined with §4.15 — `backend/recommendation/output/` being gitignored and absent — the effect
is that **the Apriori recommendation feature cannot currently be switched on through the
admin endpoint**, and product recommendations always fall back to "other products in the same
category".

#### Why it happened

The dataset was updated and the file renamed to `_v2`. The Python trainer takes the path as a
CLI argument (`--input`), so running it manually with the new name works fine. Only the
hardcoded Node-side path was left behind.

#### How it was diagnosed

Listing `backend/recommendation/data/` and comparing the filename to the string in the
controller. Also visible from the outside: every `/product/:id/recommendations` response
carries `"strategy": "category-fallback"`, which is exactly what that field is there to tell
you.

#### Fix (recommended)

Make the dataset path configurable and default it to the file that exists — for example an
`RECOMMENDATION_DATASET` environment variable falling back to
`data/Final_Apple_Apriori_Dataset_v2.csv`, or glob the newest CSV in `data/`.

#### Lesson

**A hardcoded path is a hidden coupling between two files that nothing checks.** No test, no
type, and no build step ties the controller's string to the file on disk, so renaming the data
silently broke the code.

**And notice what saved this from being invisible:** the `strategy` field in the API response.
Because the endpoint reports *which* path produced its answer, the degradation is observable
from outside without reading any code. That is a small design decision paying for itself.

### 8.7 Inconsistent hardening between two upload paths

**Status: still present in the working tree.**

#### Problem

Two multer configurations exist. The return-photo upload in `backend/routes/orderRoute.js` is
hardened:

```js
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error("Only image files (jpg, jpeg, png, webp) are allowed"));
  }
});
```

The product-image upload in `backend/routes/productRoute.js` is not:

```js
const upload = multer({ dest: "uploads/" });
```

No size limit, no type filter. Only the count is bounded, by `upload.array("images", 3)`.

#### Why it happened

The two were written at different times by different concerns. The product upload came first,
minimal; the return-photo upload was written later, after someone thought about what a user
could upload.

#### How it was diagnosed

Reading both route files side by side — the kind of inconsistency that is invisible when you
only ever read one file at a time.

#### Fix (recommended)

Extract one shared image-upload configuration into `backend/utils/` and use it in both places.
Also note that `multer({ dest: ... })` (no `diskStorage`) generates random filenames with **no
extension**, while the return path preserves `file.originalname` — meaning a user-controlled
string ends up in a filename on disk. Neither is dangerous on its own here, but a shared,
deliberate configuration is better than two accidental ones.

#### Lesson

**Security controls belong in one shared place, not copied per call site.** The moment there
are two configurations for the same concern, they will drift, and the weaker one will be the
one an attacker finds. The mitigating factor here — the product upload is behind
`verifyToken → authorizeSeller → checkSellerVerification` — is real, but "only approved
sellers can upload a 2 GB executable" is not a satisfying place to stop.

### 8.8 The legacy root `package.json`

**Status: still present in the working tree.**

#### Problem

`/package.json` declares dependencies at different major versions from the real manifests —
`react-router-dom` 7 vs the frontend's 6, `vite` 6 vs 5, `tailwindcss` 4 vs 3 — plus `multer`,
a backend-only package. Its `dev`/`build`/`preview` scripts invoke `vite` at the root, where
there is no Vite config and no `index.html`.

#### Why it happened

The repository was originally a single project and was later split into `backend/` and
`frontend/`. The root manifest was never removed.

#### How it was diagnosed

Comparing all three `package.json` files, and checking who references the root one: neither
Dockerfile, neither CI job, and no script.

#### Fix (recommended)

Delete `/package.json` and `/package-lock.json`. Also review `backend/.env`, which sits beside
the `backend/config/config.env` the app actually loads and is read by nothing.

#### Lesson

**Stale configuration files actively mislead.** A newcomer's first instinct is `npm install` at
the repository root, which here installs a set of wrong versions into a `node_modules` nothing
uses — and, worse, suggests the project is structured in a way it is not. The cost of deleting
it is zero; the cost of leaving it is a confused hour for every new contributor.

### 8.9 Missing authorization checks

**Status: still present in the working tree. These are the most consequential findings in this
section.**

#### Problem

Several endpoints are missing either a role guard or an ownership check. Each is verifiable by
reading the route line and the handler.

**a) `GET /api/v1/order/getOrder` returns every order in the system, to any logged-in user.**

```js
orderRouter.get("/getOrder", verifyToken, getAllOrder);
```

`getAllOrder` contains no role check. Any customer receives every other customer's name, email
address, delivery address, order contents, and totals. This is a data-exposure issue affecting
personal information.

**b) `PUT /api/v1/order/updateOrder/:id` and `DELETE /api/v1/order/deleteOrder/:id`** are
`verifyToken`-only, and neither handler checks ownership or role. Any logged-in user can modify
or delete any order by id.

**c) `PUT /api/v1/order/admin/return/:orderId` has no `authorizeAdmin`:**

```js
orderRouter.put("/admin/return/:orderId", verifyToken, processReturn);
```

`processReturn` only checks ownership **when the caller is a seller**:

```js
if (req.user.role === "seller") {
  if (!order.product || order.product.sellerId !== sellerId) {
    return res.status(403).json({ message: "Access denied. This order does not belong to you." });
  }
}
```

A caller with role `"user"` skips that branch entirely and may approve or reject any return —
which on approval also restores stock.

**d) `PUT /api/v1/order/admin/refund/:orderId` has no `authorizeAdmin`** and `releaseRefund`
has no role check, so any logged-in user can mark any `Return Approved` order as
`Refund Released` and zero out its revenue row.

**e) `POST /api/v1/revenue/create` has no `authorizeAdmin`:**

```js
// Admin routes
revenueRouter.post("/create", verifyToken, createRevenueRecord);
```

Any logged-in user can POST an `orderId` and mint additional `Revenue` rows, inflating reported
seller earnings and platform commission.

**f) `POST /api/v1/product/:productId/reviews` trusts the body for identity:**

```js
const { rating, comment, userName, orderId, userId } = req.body;
```

`userName` and `userId` come from the request, not from `req.user`. A logged-in user can post a
review under any name and attribute it to any user id, for a product they never bought.

**g) `cancelOrder` restores stock for `Pending` orders that never had stock deducted:**

```js
const cancellableStatuses = ["Pending", "Confirmed"];
...
order = await prisma.$transaction(async (tx) => {
  await adjustStock(order.product.id, quantity, order.variantColor, order.variantStorage, 1, tx);
```

Since deduction happens only at confirmation, cancelling a `Pending` order increments stock by
the order quantity. `userDeleteOrder`, in the same file, guards correctly with
`['Confirmed', 'Processing', 'Shipped'].includes(order.status)`.

**h) Promo discounts are client-supplied** (§4.14). `createOrder` subtracts
`promoCode.discountAmount` from the request body without re-deriving it from the `PromoCode`
row, and `checkout` then signs an eSewa form for the resulting `totalPrice`.

**i) `/api/v1/chat` and `/api/v1/email/test-email` are unauthenticated.** The chat endpoint has
no rate limit and spends the project's Groq quota; the test-email endpoint sends mail to an
arbitrary address and logs the length of `EMAIL_PASS` to the server console.

#### Why it happened

Two recurring causes.

**Guards live in two places.** Role checks are in the route file, ownership checks are in the
handler. When a route is added, it is easy to write the handler correctly and forget the route
guard — or vice versa. Compare `userManagementRoute.js`, which uses
`router.use(verifyToken, authorizeAdmin)` and therefore *cannot* have this problem for any
route added below it.

**"Admin" in a path is not a guard.** Routes named `/admin/return/:orderId` and
`/admin/refund/:orderId` read as protected. A path segment enforces nothing.

For (f), the review endpoint predates the current auth model and was never revisited after
`req.user` became reliably available.

#### How it was diagnosed

By reading each route file next to its handler and asking two questions per endpoint: *which
roles may call this?* and *does this handler verify that the caller owns the resource it is
about to modify?*

#### Fix (recommended)

- Add `authorizeAdmin` to `getAllOrder`'s route (or paginate and restrict it), and to the
  `/admin/return`, `/admin/refund`, and `/revenue/create` routes.
- Add ownership or admin checks inside `updateOrder` and `deleteOrder`.
- In `processReturn`, invert the logic: require `admin` **or** an owning seller, rather than
  only restricting sellers.
- In `addProductReview`, take `userId` from `req.user.id` and `userName` from the database, and
  verify a matching delivered `Order` exists before accepting the review.
- In `cancelOrder`, only restore stock when the order was previously `Confirmed` or later.
- Re-derive promo discounts server-side at order creation.
- Add `verifyToken` + a rate limit to `/api/v1/chat`; remove or gate `/api/v1/email`.

#### Lesson

**Authorization has two independent halves, and both must be present on every endpoint: "what
role are you?" and "is this yours?"** Getting one right feels like getting security right, and
is not.

**Prefer guards that are hard to omit.** `router.use(verifyToken, authorizeAdmin)` protects
every route added afterwards, forever. Per-route guards protect only the routes someone
remembered. When the same concern is expressed both ways in one codebase, the per-route
version is where the gaps will be.

**And: a naming convention is not an access control.** `/admin/` in a path is documentation.
`authorizeAdmin` in the middleware chain is enforcement.

### 8.10 The `_id` versus `id` mismatch

**Status: still present in the working tree.**

#### Problem

The migration's compatibility shim was applied to **products** but not to **orders**.

Products go through `formatProductResponse`, which adds `_id`:

```js
export const formatProductResponse = (product) => ({ ...product, _id: product._id || product.id, ... });
```

Orders go through `withNestedOrderShape`, which does **not**:

```js
const withNestedOrderShape = (order) => {
  const { deliveryStreet, ..., ...rest } = order;
  return { ...rest, deliveryAddress: {...}, variants: {...}, promoCode: ... };
};
```

So an order in a response has `id` and no `_id`. But frontend code reads `_id` in places:

```tsx
// frontend/src/pages/BuyProduct.tsx
const newOrderId = response.data.order._id;
```

```tsx
// frontend/src/pages/Success.tsx
const foundOrder = orderRes.data.find((o: Order) => o._id === orderId);
```

whereas `CartCheckout.tsx` reads the correct field:

```tsx
const orderId = responseData.order.id; // Primary order for payment
```

In `BuyProduct.tsx`, `newOrderId` is therefore `undefined`, and the subsequent
`POST /payment/checkout` sends `{ orderId: undefined }`, which the endpoint rejects with
`400 "orderId is required"`. In `Success.tsx`, `foundOrder` is `undefined`, so the summary block
does not render (the separately-fetched `orderDetails` block still does).

#### Why it happened

The compatibility layer was added where a symptom appeared — the product listing — rather than
applied uniformly to every response shape the migration changed. `CartCheckout.tsx` was
evidently written or updated after the migration and uses `id`; `BuyProduct.tsx` and
`Success.tsx` still carry the pre-migration field name.

#### How it was diagnosed

By tracing what `createOrder` actually returns (`{ success: true, order: withNestedOrderShape(order) }`,
which carries `id`) and comparing it to what each caller reads.

#### Fix (recommended)

Pick one and apply it everywhere. Either add `_id` in `withNestedOrderShape` for consistency
with products, or — better — update the frontend to use `id` throughout and delete the shim
from `formatProductResponse` as well. A shared TypeScript type for API responses would have
made the mismatch a compile error rather than a runtime `undefined`.

#### Lesson

**A compatibility shim must be applied at the boundary, uniformly — not per symptom.** Half a
shim is worse than none: it makes some code paths work, which hides the fact that the others
do not.

**And: `undefined` is JavaScript's quietest failure.** Reading a missing property throws
nothing; it returns `undefined` and the bug surfaces three function calls later as a confusing
400. TypeScript types shared between client and server (or a generated client) turn that class
of mistake into a build failure.

### 8.11 The `adminCommission` ReferenceError in bulk orders

**Status: fixed in commit `39904f6`.**

#### Problem

The commit message states it exactly: *"adminCommission was referenced but never computed, so
bulk-order revenue rows silently never got created."*

In `createBulkOrderFromCart`, the revenue-creation block referenced an `adminCommission`
variable that existed in `createOrder` but had never been declared in the bulk path. Referencing
an undeclared identifier throws `ReferenceError` — and the block was wrapped in a `try/catch`
that logged and continued:

```js
try {
  await prisma.revenue.create({ data: { ... } });
} catch (revenueError) {
  console.error("Error creating revenue record:", revenueError);
}
```

So **every multi-item checkout completed successfully and produced no revenue records at all.**
Orders were placed, payments taken, stock deducted — and sellers' reported earnings and the
platform's reported commission simply omitted every cart checkout.

#### Why it happened

Two causes compounding.

**Copy-paste divergence.** `createBulkOrderFromCart` was written by adapting `createOrder`. In
the original, `adminCommission` was computed as a local variable:

```js
const adminCommission = totalPrice * 0.05;
```

In the bulk version the commission is computed inline per item (`adminCommission: itemTotal * 0.05`
on the order), and the standalone variable was never introduced — but the revenue block still
referred to it.

**A catch block that swallowed the evidence.** The `try/catch` was there for a good reason —
"don't fail an order because analytics failed" — but it converted a hard crash into a log line
nobody was reading. In JavaScript, an undefined variable is a runtime error, not a compile
error, so nothing caught it earlier.

#### How it was diagnosed

Almost certainly by noticing missing data: revenue totals not matching orders, specifically for
multi-item checkouts. The tell is that single-item orders worked and bulk orders did not — which
points straight at the one code path that differs.

#### Fix

Commit `39904f6`. The current code computes the commission per item, inline:

```js
await prisma.revenue.create({
  data: {
    id: generateId(),
    orderId: order.id,
    sellerId: productDetails.sellerId,
    adminId: null,
    productId: item.productId,
    totalSalePrice: itemTotal,
    adminCommission: itemTotal * 0.05,
    sellerRevenue: itemTotal * 0.95,
    transactionDate: now,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    status: "Pending",
  },
});
```

#### Lesson

**A `catch` that only logs turns a loud failure into a silent one.** The intent — protect the
purchase flow — was right. The implementation hid a total feature failure behind a
`console.error` in a log nobody tails. If a side effect is genuinely optional, its failure
should still be *visible*: a metric, an alert, or a status field on the row, not just a log line.

**And: duplicated logic diverges.** `createOrder` and `createBulkOrderFromCart` share most of
their behaviour — pricing, commission, revenue creation, order numbering — as two independent
copies. This bug is one consequence; the promo double-discount subtlety in §4.14 is another,
arising from the same duplication. Extracting a shared `createOrderRow(item, context)` helper
would remove both classes of problem at once.

### 8.12 The cart's stored `totalPrice` means different things in different handlers

**Status: still present in the working tree.**

#### Problem

`addToCart` persists a discount-aware total:

```js
const { itemsWithDiscount, totalPrice, totalDiscount, finalPrice } = withDiscount(populatedCart.items);
await prisma.cart.update({ where: { id: populatedCart.id }, data: { totalPrice, updatedAt: new Date() } });
```

`updateCartItem`, `removeFromCart`, and `clearCart` each compute their own, discount-free:

```js
const totalPrice = populatedCart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
await prisma.cart.update({ where: { id: populatedCart.id }, data: { totalPrice, updatedAt: new Date() } });
```

(Strictly, `withDiscount`'s `totalPrice` is *also* pre-discount — the discounted figure is its
`finalPrice`. So the two happen to agree today. But the two code paths compute it differently,
and there is nothing keeping them aligned if either changes.)

#### Why it happened

Under Mongoose, this was a single `pre('save')` hook — one implementation, impossible to
diverge. Prisma has no equivalent, so the migration turned one implicit computation into four
explicit ones written at different moments.

#### How it was diagnosed

By reading all four handlers in `cartController.js` in sequence and noticing that one of them
computes the total differently from the other three.

#### Fix (recommended)

Extract a single `recalculateCartTotal(cartId)` helper and call it from all four handlers. Or —
simpler, and more in keeping with how the code already behaves — **drop the stored
`totalPrice` column entirely**, since every read path already recomputes totals via
`withDiscount` and ignores the stored value.

#### Lesson

**When migrating away from implicit framework behaviour, find every place it used to fire.**
An ORM hook is invisible in the calling code, which is exactly what makes it easy to under-count
when replacing it. Grepping for the hook's *effects* (here, `totalPrice`) rather than for its
call sites is the reliable way to enumerate them.

**And: derived data stored in the database is a synchronisation obligation.** A column that can
be recomputed cheaply from its inputs is often better recomputed than stored — you cannot have
a stale copy of something you never copied.

### 8.13 Summary table of open issues

| # | Issue | Severity | File(s) |
|---|---|---|---|
| 8.9a | `GET /order/getOrder` exposes all orders to any user | High | `routes/orderRoute.js` |
| 8.9b | `updateOrder` / `deleteOrder` lack ownership checks | High | `routes/orderRoute.js`, `controller/order.js` |
| 8.9c | `/admin/return/:orderId` lacks `authorizeAdmin` | High | `routes/orderRoute.js` |
| 8.9d | `/admin/refund/:orderId` lacks `authorizeAdmin` | High | `routes/orderRoute.js` |
| 8.9h | Promo discount is client-supplied and not re-derived | High | `controller/order.js` |
| 8.9e | `POST /revenue/create` lacks `authorizeAdmin` | Medium | `routes/revenueRoute.js` |
| 8.9f | Reviews trust `userId`/`userName` from the body | Medium | `controller/productController.js` |
| 8.9g | `cancelOrder` restores stock for never-deducted orders | Medium | `controller/order.js` |
| 8.9i | `/chat` unauthenticated + unlimited; `/email` unauthenticated | Medium | `routes/chatRoute.js`, `routes/testEmailRoute.js` |
| 8.3 | Orphaned `PaymentForm.tsx` with browser-side HMAC signing | Medium | `frontend/src/pages/PaymentForm.tsx` |
| 8.4 | Six pages use `fetch` with the sentinel token → always 401 | Medium | six frontend files |
| 8.10 | `_id` vs `id` breaks `BuyProduct` checkout | Medium | `frontend/src/pages/BuyProduct.tsx` |
| 8.6 | Retrain endpoint points at a renamed dataset file | Low | `controller/productController.js` |
| 8.7 | Product upload lacks size/type limits | Low | `routes/productRoute.js` |
| 8.12 | Cart `totalPrice` computed inconsistently | Low | `controller/cartController.js` |
| 8.5 | Stale comment on `generateBill`; dead branch in `error.js` | Low | `controller/order.js`, `middlewares/error.js` |
| 8.8 | Legacy root `package.json` with conflicting versions | Low | `/package.json` |
| — | No cleanup job for expired `refresh_tokens` | Low | — |
| — | Bulk order creation is not transactional | Low | `controller/order.js` |
| — | CORS private-IP regexes are unanchored and active in production | Low | `backend/app.js` |

---

## 9. Final Understanding Check

These questions are answerable from this document plus the repository. They require reasoning
about *why*, not recall of *what*. Work through them before considering the material learned.

### 9.1 System design

1. ShopSphere creates **one `Order` row per cart item**, linked by `orderGroupId`, rather than
   one order with many line items. Give two concrete things this makes easy, and one thing it
   makes harder. Which specific queries in `getSellerOrders` and `confirmOrderCore` depend on
   this choice?

2. `backend/utils/generateId.js` produces 24-character hex strings rather than UUIDs or
   auto-incrementing integers. Explain the constraint that forced this. Now suppose the project
   wanted to switch to UUIDs today: list every place in the system that would have to change,
   including things outside the database.

3. The `Product` model has *three* representations of variants: `variantColor` string arrays,
   `ProductColorVariant` rows with stock, and a base `quantity`. Explain what each is for. Then
   explain, with a concrete numeric example, how the system can oversell despite checking stock.

4. `PaymentEvent` is append-only and `Payment` is described as a "read-model projection". If
   the `payments` table were accidentally truncated tomorrow, could it be rebuilt? From what?
   What information, if any, would be lost?

5. The recommendation model is trained **offline** in Python and consumed as a static JSON file
   with a 5-minute in-memory cache. Name two properties this buys and two it gives up. Under
   what change in requirements would this design stop being appropriate?

6. `frontend/src/App.tsx` uses `HashRouter`. Explain the deployment problem this avoids, quoting
   the reasoning in `frontend/Dockerfile`. Then explain why a marketplace might nonetheless
   regret it, and what would have to change to move to `BrowserRouter`.

### 9.2 Security reasoning

7. The access token is a JWT stored in JavaScript memory; the refresh token is opaque random
   bytes stored as a SHA-256 hash and delivered in an httpOnly cookie. Explain **each** of those
   four choices — JWT vs opaque, memory vs cookie, hashed vs plaintext at rest, httpOnly vs
   readable — in terms of the specific attack each addresses.

8. Passwords use Argon2id with `memoryCost: 19456`; refresh tokens use plain SHA-256. Both are
   secrets stored as hashes. Why is a fast hash correct for one and dangerous for the other?

9. Walk through exactly what happens if an attacker steals a refresh token from a network log
   and replays it two hours later, after the legitimate user has refreshed once. Name the
   function, the condition that fires, and the effect on both parties. Then explain why this
   detection would be **impossible** without token rotation.

10. The refresh cookie is scoped `path: "/api/v1/auth"`. Suppose a logging middleware were added
    that recorded all request headers on `/api/v1/order`. Would the refresh token appear in
    those logs? Why or why not — and what security principle does this illustrate?

11. `backend/app.js` contains a comment describing a past vulnerability where the frontend
    trusted the eSewa redirect. Explain the attack in concrete steps. Then name the **four**
    independent defences that now exist, and explain which one alone would still be insufficient
    and why.

12. `verifyCallbackSignature` proves the callback genuinely came from eSewa. Why is
    `checkTransactionStatus` still necessary? Give a scenario where the signature is completely
    valid but acting on the callback alone would be wrong.

13. Migration `20260824183326_ledger_append_only` runs
    `REVOKE UPDATE, DELETE ON payment_events FROM shopsphere`. What class of threat does this
    stop that a code comment saying "never update this table" cannot? Name two deployment
    configurations in which this `REVOKE` would silently have no effect.

14. `frontend/src/lib/session.ts` writes `localStorage.setItem("isAdmin", String(user.admin))`,
    and `NavBar.tsx` renders admin links based on it. A user edits `localStorage.isAdmin` to
    `"true"`. What do they see, what happens when they click those links, and why is this **not**
    a privilege escalation? What would have to be true elsewhere in the system for it to become
    one?

15. `checkSellerVerification` performs a database read, while `authorizeAdmin` and
    `authorizeSeller` read the role from the JWT. Explain why that asymmetry is deliberate and
    correct. What would break if `isVerified` were put into the JWT instead?

### 9.3 Data flow

16. Trace a **multi-item cart checkout** from clicking "Proceed to checkout" to the confirmation
    email, naming every HTTP request, every controller function, and every table written. At
    which exact step is stock deducted, and why not earlier?

17. `frontend/src/pages/Success.tsx` calls `PUT /order/confirm/:orderId` even though the eSewa
    webhook already called `confirmOrderCore` for the same order. Explain why this is safe, name
    the specific guard that makes it a no-op, and describe the failure mode this second call is
    designed to recover from.

18. A user's access token expires mid-session while they are on the cart page. Trace every step
    from the failing request to the successful retry, naming the axios interceptor logic, the
    backend function, and the database rows touched. What does the user see?

19. Compare the promo-discount handling in `createOrder` and `createBulkOrderFromCart`. Where
    does each store the discount? Now read the `totalAmount` computation in `payment.js`'s
    `checkout` and explain precisely what would go wrong if the `order.orderGroupId ? ... : 0`
    condition were removed.

20. A customer requests a return 9 days after delivery. Which check rejects it, in which
    function, and what is the fallback if `deliveredAt` was never set? Why does that fallback
    exist at all?

21. `getProducts` includes each product's **full review list** on the listing page, but
    `ProductCard` only uses the review count and average rating. Explain why the code is like
    this (hint: the migration), what it costs, and what the efficient alternative would be.

### 9.4 Component interaction

22. `backend/controller/order.js` exports `confirmOrderCore` separately from
    `confirmOrderAndDeductStock`. Explain the design reason. What would you have to change to
    call the confirmation logic from a new admin "force confirm" endpoint, and what would you
    need to be careful about?

23. `adjustStock` takes a `client = prisma` parameter. Name the **two** distinct purposes that
    single parameter serves. What silently breaks if a caller inside a `$transaction` forgets to
    pass `tx` — and would any existing test catch it?

24. `frontend/src/lib/session.ts` keeps a module-level `refreshPromise`. Describe, step by step,
    what would go wrong on a page that fires six parallel API calls if that variable did not
    exist. Connect your answer to `rotateRefreshToken`'s reuse detection.

25. Six frontend files call the API with `fetch()` rather than `axios`. Explain the two things
    they lose. Why does the `localStorage.token = "session"` sentinel make this failure harder to
    notice than it would otherwise be?

26. `backend/app.js` registers `express.json()` **before** the routers and `errorMiddleware`
    **after** them. Explain what breaks in each case if the order were reversed, and give the
    general principle governing middleware ordering.

27. `productRouter.post("/create", verifyToken, authorizeSeller, checkSellerVerification, createProduct)`
    lists three guards in that specific order. Explain why each position is required — one for a
    dependency reason, one for a cost reason.

### 9.5 Trade-offs

28. `withIdempotency` relies on a unique-constraint violation (`P2002`) rather than an
    application-level lock or a Redis mutex. Argue the case for this choice on correctness
    grounds, not just simplicity. Then name two real downsides.

29. `sendEmail` catches every error and never throws, and every call site omits `await`. Name
    two things this protects and two things it gives up. Design a minimal improvement that keeps
    the protection but removes one of the losses.

30. Revenue reports load every matching row and sum them with `reduce` in JavaScript, even
    though `@@index([sellerId, year, month])` exists in the schema. Explain what that index was
    for, why the current code does not benefit from it, and at roughly what data volume this
    becomes a real problem.

31. Notification fan-out inserts one row per user, synchronously, inside the product-creation
    request. Explain the scaling characteristic in Big-O terms, describe what the seller
    experiences at 100,000 users, and outline the fan-out-on-read alternative.

32. Pagination was added as **opt-in** (`?page=&limit=`), preserving the bare-array response
    when the parameters are absent. Explain the constraint that forced this. What would have
    happened if the response shape had simply been changed, and why would it have been hard to
    catch in review?

33. The project migrated from MongoDB to PostgreSQL mid-development — an expensive change. Make
    the case that it was worth it, citing at least three specific mechanisms in the current
    codebase that depend on relational features. Then name three costs still visible in the code
    today.

34. Stock is deducted at payment confirmation rather than order creation. Give the failure mode
    of each option, explain which one ShopSphere accepted, and describe the third option
    (reserve-then-commit) including what infrastructure it would require.

### 9.6 Reading the code critically

35. `backend/controller/order.js` says above `generateBill`: *"Bill is built and returned
    in-memory only … so this doesn't touch prisma.bill either."* Read the function. Is the
    comment true? What does that tell you about how to treat comments, and which *kind* of
    comment in this codebase has aged well?

36. `updateSellerOrderStatus` validates against
    `validStatuses = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]` and then
    handles `status === "Confirmed"`. Identify both problems here — one is dead code, the other
    is a missing constraint. What would a proper state machine look like?

37. `GET /api/v1/order/getOrder` is guarded only by `verifyToken`. Write out exactly what a
    logged-in customer receives when they call it, and classify the severity. Then propose two
    different fixes and argue for one.

38. Search `frontend/src` for who navigates to the `/payment` route. Given what you find, what
    should happen to `frontend/src/pages/PaymentForm.tsx`, and why is leaving it in place worse
    than merely untidy?

39. `retrainProductRecommendations` resolves `data/Final_Apple_Apriori_Dataset.csv`. List
    `backend/recommendation/data/`. What happens when an admin calls that endpoint, and which
    field in the `/recommendations` response would have let you detect the resulting degradation
    without reading any code?

40. Compare stock restoration in `cancelOrder` and in `userDeleteOrder`. They handle the same
    concern differently. Which one is correct, given when stock is deducted, and what is the
    concrete consequence of the other?

### 9.7 Synthesis

41. You are asked to add **wishlists**. Design it end to end: the Prisma model, the migration,
    the router and controller, the authorization rules, and the frontend page. Which existing
    pattern in the repo would you copy, and which existing mistake would you be careful not to?

42. You are asked to support a **second payment gateway** alongside eSewa. Which files change,
    which stay as they are, and why? What in the current `Payment` / `PaymentEvent` design makes
    this easier than it might have been, and what one field would need rethinking?

43. Traffic grows 100×. Rank the ten scalability limits in §6.9 by which will hurt first, and
    justify your top three. For each, state whether the fix is a swap behind an existing seam or
    a genuine redesign.

44. A customer claims they were charged but their order was never confirmed. Using only what
    exists in this repository, describe your investigation: which tables you query, in which
    order, what each would tell you, and how the append-only ledger changes what you can prove.

45. Finally: pick the **three** decisions in this codebase you consider most consequential — for
    good or ill — and defend your choices. For each, state what would have happened had the
    opposite decision been made.

---

## Appendix A: Quick reference

### Environment variables

**Backend** — `backend/config/config.env`, template at `backend/config/config.env.example`:

| Variable | Purpose | Required |
|---|---|---|
| `PORT` | API port | No (default 4000) |
| `FRONTEND_URL` | Allowed CORS origin; redirect target after payment | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Signs and verifies access tokens | Yes |
| `ADMIN_EMAIL` | Bootstrap admin; also receives return-request emails | Yes |
| `ADMIN_PASSWORD` | Bootstrap admin password | Yes |
| `SEED_DEMO_DATA` | `"true"` seeds demo sellers/customers/products at boot | No |
| `NODE_ENV` | `"production"` enables HSTS and the `secure` cookie flag | No |
| `GOOGLE_CLIENT_ID` | Verifies Google ID tokens | For Google login |
| `EMAIL_USER` / `EMAIL_PASS` | Gmail SMTP credentials | For email |
| `GROQ_API_KEY` | Chat assistant | For chat |
| `ESEWA_PRODUCT_CODE` | eSewa merchant code (`EPAYTEST` in sandbox) | Yes |
| `ESEWA_SECRET_KEY` | HMAC signing key | Yes |
| `ESEWA_FORM_URL` | Checkout form endpoint | Yes |
| `ESEWA_STATUS_URL` | Transaction status-check endpoint | Yes |

**Frontend** — `frontend/.env`:

| Variable | Purpose |
|---|---|
| `VITE_BACKEND_URL` | Backend API base URL |
| `VITE_GOOGLE_CLIENT_ID` | Google Sign-In client id |

> Only variables prefixed `VITE_` are exposed to browser code by Vite — and they are **compiled
> into the bundle**, so they are public. Never put a secret in one.

### Commands

Backend:

```bash
cd backend && npm install
```
```bash
cd backend && npm run dev
```
```bash
cd backend && npm test
```
```bash
cd backend && npx prisma migrate deploy
```
```bash
cd backend && npx prisma generate
```

Frontend:

```bash
cd frontend && npm install
```
```bash
cd frontend && npm run dev
```
```bash
cd frontend && npm test
```
```bash
cd frontend && npm run build
```

Everything, containerised:

```bash
docker compose up -d --build
```

Recommendation model (optional):

```bash
cd backend/recommendation && python3 -m venv .venv && pip install -r requirements.txt
```
```bash
cd backend/recommendation && python train_apriori.py --input ./data/Final_Apple_Apriori_Dataset_v2.csv --output-dir ./output
```

### The 16 Prisma models

| Model | Table | Purpose |
|---|---|---|
| `User` | `users` | Customers, sellers, and admins in one table, split by `role` |
| `RefreshToken` | `refresh_tokens` | Rotating refresh-token families; stores hashes only |
| `Product` | `products` | Catalogue entries with base stock and variant option lists |
| `ProductColorVariant` | `product_color_variants` | Per-colour stock and images |
| `ProductStorageVariant` | `product_storage_variants` | Per-storage stock |
| `ProductReview` | `product_reviews` | Ratings and comments |
| `Order` | `orders` | One row per purchased item; flattened address and variants |
| `IdempotencyKey` | `idempotency_keys` | Exactly-once checkout, via its unique primary key |
| `PaymentEvent` | `payment_events` | Append-only payment audit ledger (UPDATE/DELETE revoked) |
| `Payment` | `payments` | Current payment state — a projection of the ledger |
| `Cart` | `carts` | One server-side cart per user |
| `CartItem` | `cart_items` | Cart lines with a price snapshot and JSON variants |
| `Revenue` | `revenues` | Per-order commission split for reporting |
| `Notification` | `notifications` | In-app notifications, polled every 30 s |
| `PromoCode` | `promo_codes` | Discount codes with limits and validity windows |
| `PromoCodeUsage` | `promo_code_usages` | One-use-per-customer, enforced by a composite key |
| `Bill` | `bills` | Persisted invoice records, upserted deterministically |

### Where to look first

| If you want to understand… | Read |
|---|---|
| The whole request pipeline | `backend/app.js` |
| The data model | `backend/prisma/schema.prisma` |
| Authentication | `backend/utils/tokens.js`, `backend/utils/refreshTokenStore.js`, `backend/controller/auth.js`, `frontend/src/lib/session.ts` |
| Authorization | `backend/middlewares/authMiddleware.js` plus the route files |
| Payments | `backend/utils/esewa.js`, `backend/utils/idempotency.js`, `backend/controller/payment.js` |
| The order lifecycle | `backend/controller/order.js` (`confirmOrderCore` first) |
| Frontend routing and boot | `frontend/src/App.tsx`, `frontend/src/main.tsx` |
| Deployment | `docker-compose.yml`, both `Dockerfile`s, `.github/workflows/ci.yml` |

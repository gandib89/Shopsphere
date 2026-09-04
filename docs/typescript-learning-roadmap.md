# Learning TypeScript Through ShopSphere

A beginner-friendly map of every TypeScript idea you need in order to read, change, and extend the ShopSphere frontend.

This document does not teach the concepts yet. It tells you **what exists in this project**, **what you must learn**, **what you can skip**, and **in what order to learn it**.

Everything here comes from reading the actual code. Nothing is invented.

---

## Table of contents

1. [What TypeScript is, in one paragraph](#1-what-typescript-is-in-one-paragraph)
2. [The setup in this project](#2-the-setup-in-this-project)
3. [Where TypeScript lives](#3-where-typescript-lives)
4. [The two styles of TypeScript inside ShopSphere](#4-the-two-styles-of-typescript-inside-shopsphere)
5. [What is used, lightly used, and not used at all](#5-what-is-used-lightly-used-and-not-used-at-all)
6. [The most important files to read](#6-the-most-important-files-to-read)
7. [Full concept inventory](#7-full-concept-inventory)
8. [The business entities in ShopSphere](#8-the-business-entities-in-shopsphere)
9. [The two big gaps in this codebase](#9-the-two-big-gaps-in-this-codebase)
10. [MUST KNOW / SHOULD KNOW / NICE TO KNOW / NOT NEEDED](#10-must-know--should-know--nice-to-know--not-needed)
11. [Learning order](#11-learning-order)
12. [Detailed roadmap, level by level](#12-detailed-roadmap-level-by-level)
13. [How TypeScript fits the whole frontend](#13-how-typescript-fits-the-whole-frontend)
14. [Small things to know before you start](#14-small-things-to-know-before-you-start)

---

## 1. What TypeScript is, in one paragraph

JavaScript lets you write anything, and you only find out it was wrong when the page breaks in the browser. TypeScript is JavaScript plus **labels that describe your data**. You write those labels, and a checker reads them while you type and tells you "this will break" before you ever run the code. The labels are deleted before the browser sees the file. The browser only ever runs plain JavaScript. TypeScript is a safety net for the developer, not a feature for the user.

A term you will see a lot in this document:

- **Type** — a description of what a value is allowed to be. `string`, `number`, "an array of products", "a product or nothing".

---

## 2. The setup in this project

| Thing | Value |
|---|---|
| TypeScript files | 63 `.ts` and `.tsx` files, all inside `frontend/src` |
| Backend language | Plain JavaScript (`backend/app.js`, `backend/controller/*.js`) |
| Compiler settings | `frontend/tsconfig.app.json` |
| Strict mode | **On** (`"strict": true`) |
| Extra strict rules | `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` |
| Build command | `vite build` |
| Test setup | Vitest + Testing Library, tests written in `.tsx` |
| Central types file | **Does not exist** |

Two of these matter more than the rest.

### Strict mode is on

"Strict mode" means TypeScript will not let things slide. In particular:

- Every function parameter must have a type, or TypeScript refuses.
- `null` and `undefined` are treated as real, separate possibilities. If something might be missing, you must handle it.
- A variable you declare but never use is an error, not a warning.

This is the good setting. It also means beginners hit more errors early. Those errors are the point.

### The build does **not** check types

`npm run build` runs `vite build`. Vite strips TypeScript labels out and bundles the code. It never verifies that the labels were correct.

**What this means for you:**

- Type errors appear in your editor (VS Code) but do not stop a build.
- A file can be full of type mistakes and still deploy.
- To actually check the whole project, run this yourself:

```bash
cd frontend && npx tsc -b
```

Get in the habit of running that before you commit.

---

## 3. Where TypeScript lives

```text
frontend/src
│
├── lib/
│   ├── session.ts        the closest thing to an "API layer"; login, logout, tokens
│   └── utils.ts          three small typed helper functions
│
├── components/           reusable UI — the best-written TypeScript in the project
│   ├── ui/               Button, Field, Status, AsyncState, sonner
│   ├── catalog/          ProductCard, Money
│   ├── auth/             ProtectedRoute, RoleSelector
│   ├── checkout/         CartSummary
│   ├── operations/       PageHeader, ActionList
│   ├── NavBar.tsx  Footer.tsx  ChatWidget.tsx  NotificationBell.tsx  OrbitMark.tsx
│   └── *.test.tsx        component tests
│
├── pages/                41 route pages — one file per screen
│
├── test/
│   ├── render.tsx        test helper that wraps a component in a router
│   └── setup.ts
│
├── App.tsx               routes, lazy-loaded pages
├── main.tsx              app entry point
└── vite-env.d.ts         one line, tells TypeScript about Vite's env variables
```

The backend is JavaScript, so it plays no part in this learning path. There is one `.ts` file there (`backend/prisma.config.ts`) and it teaches nothing you need.

---

## 4. The two styles of TypeScript inside ShopSphere

This is the single most useful thing to understand before you begin. ShopSphere contains **two different qualities of TypeScript**, and you should learn from one and practise on the other.

### Style A — `components/` — careful, modern TypeScript

These files were written or rewritten recently and written well. They use:

- named types for props
- unions of fixed string values
- `Record`, `Omit`, `Partial`
- intersection types (`&`)
- React's built-in HTML attribute types
- `forwardRef` with type parameters

Example, from `frontend/src/components/ui/Button.tsx`:

```ts
type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};
```

**Read these files to learn the language.**

### Style B — `pages/` — beginner TypeScript

These 41 files were written earlier and more quickly. They:

- declare their own local `interface Product`, `interface Order`, `interface CartItem` in each file
- never type the data coming back from the server
- use `catch (err: any)` almost everywhere — 53 uses of `any` in total

Example, from `frontend/src/pages/Home.tsx`:

```ts
const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/v1/product/search`, { ... });
setData(response.data || []);
```

`response.data` has no type at all here. TypeScript has no idea what came back, so it checks nothing.

**Practise on these files once you know the language.**

---

## 5. What is used, lightly used, and not used at all

### Used heavily — learn these first

| Concept | Where |
|---|---|
| Prop types on components | every file in `components/` |
| `useState<T>` with a type | 60+ places across `pages/` |
| Domain interfaces (`Product`, `Order`, `CartItem`) | declared inside each page |
| Optional properties (`name?: string`) | everywhere, very heavily |
| Union with null (`Product \| null`) | 20+ `useState` calls |
| React event types (`React.FormEvent`, `React.ChangeEvent`) | ~20 handlers |
| Unions of fixed strings (`'user' \| 'seller' \| 'admin'`) | roles, button variants, statuses |
| `Record<string, string>` lookup tables | ~12 places |
| Optional chaining `?.` and `??` | throughout |

### Used lightly — good to recognise

| Concept | Where |
|---|---|
| `Omit<T, K>` | `ui/Button.tsx:49`, `ui/Field.tsx:28` |
| `Partial<T>` | `ui/AsyncState.tsx:17`, `pages/ProductDetailsAdmin.tsx:35`, `pages/SellerProductDetails.tsx:37` |
| `keyof typeof` | `pages/AddProduct.tsx` (several lines) |
| `ComponentProps<typeof X>` | `ui/sonner.tsx:5` |
| `useRef<HTMLDivElement>(null)` | 5 places |
| `forwardRef<Element, Props>` | 4 components |
| Type assertions (`as`) | ~10 places |
| `useParams<{ orderId: string }>()` | `pages/TrackOrder.tsx:66` — only once |
| `React.FC` | `components/ChatWidget.tsx` — only once, and no longer recommended |

### Not used at all — do not go hunting for these

| Concept | Note |
|---|---|
| **React Context API** | Zero `createContext` in the project. Login state is read from `localStorage` inside each page instead. |
| **Axios generics** (`axios.get<Product[]>`) | Zero uses. Every server response is untyped. |
| `enum` | None. Modern practice prefers unions of strings anyway, which this project already does. |
| Generic functions you write yourself | None. |
| Discriminated unions | None, though two places would benefit. |
| Mapped types, conditional types, template literal types | None. |
| `satisfies`, `unknown`, `never` | None. |

---

## 6. The most important files to read

Read them in this order. Each one adds a little on top of the previous.

| # | File | What it teaches |
|---|---|---|
| 1 | `frontend/src/lib/utils.ts` | Tiny. Three typed functions. Parameter types, return types, `string \| undefined \| null`. |
| 2 | `frontend/src/components/catalog/Money.tsx` | Smallest component with typed props. Optional prop. |
| 3 | `frontend/src/components/auth/ProtectedRoute.tsx` | `type Props`, a union of two strings, `ReactNode`. 20 lines. |
| 4 | `frontend/src/components/catalog/ProductCard.tsx` | The best single example: an exported domain type, optional fields, arrays of objects, callback props, a `Record` lookup. |
| 5 | `frontend/src/components/ui/Status.tsx` | Union type used as the key of a `Record`. Shows why this pairing is powerful. |
| 6 | `frontend/src/components/ui/Button.tsx` | Intersection types, `Record<Union, string>`, `Omit`, `forwardRef`. |
| 7 | `frontend/src/components/ui/Field.tsx` | The same patterns repeated for input, textarea and select. Shows the payoff. |
| 8 | `frontend/src/lib/session.ts` | The only real API module. `SessionUser`, `Promise<string \| null>`, `as SessionUser`, axios interceptors. |
| 9 | `frontend/src/pages/Home.tsx` | A real page start to finish: state, handlers, axios, `error: any`. |
| 10 | `frontend/src/pages/Cart.tsx` | Nested object types, `Record<string, string>` for product variants. |
| 11 | `frontend/src/pages/OrderDetails.tsx` | The largest type in the project. Deeply nested, heavily optional. |
| 12 | `frontend/src/components/catalog/catalog.test.tsx` | A type used as a test fixture — proof that types describe real data. |

---

## 7. Full concept inventory

"Used?" means: does this actually appear in the ShopSphere code today?

| Concept | Used? | Example location | Importance |
|---|---|---|---|
| Basic annotations (`string`, `number`, `boolean`) | Yes | everywhere | Basic |
| Arrays (`string[]`, `Product[]`) | Yes | `ProductCard.tsx:13` | Critical |
| Optional properties (`?`) | Yes, very heavy | `OrderDetails.tsx` | Critical |
| Nested object types | Yes | `Cart.tsx:13`, `OrderDetails.tsx:22` | Critical |
| `interface` | Yes, ~35 declarations | all pages | Critical |
| `type` alias | Yes, ~20 declarations | `components/` | Critical |
| Union of fixed strings | Yes | `RoleSelector.tsx:4`, `Button.tsx:4` | High |
| Union with `null` | Yes, very heavy | 20+ `useState` calls | Critical |
| Intersection (`&`) | Yes | `Button.tsx:7`, `Field.tsx:28` | High |
| `Record<K, V>` | Yes, ~12 | `Button.tsx:13`, `Home.tsx:14` | High |
| `Omit<T, K>` | Yes, 2 | `Button.tsx:49`, `Field.tsx:28` | Medium |
| `Partial<T>` | Yes, 3 | `AsyncState.tsx:17` | Medium |
| `Pick<T, K>` | No | — | Medium (useful later) |
| `keyof typeof` | Yes | `AddProduct.tsx:236` | Medium |
| `ComponentProps<typeof X>` | Yes, 1 | `sonner.tsx:5` | Low |
| Component prop typing | Yes | every component | Critical |
| `ReactNode` / `ReactElement` | Yes | `ActionList.tsx:1`, `test/render.tsx:1` | High |
| `useState<T>` | Yes, 60+ | all pages | Critical |
| Event types | Yes, ~20 | `AddProduct.tsx:212` | High |
| `useRef<T>` | Yes, 5 | `ChatWidget.tsx:21` | Medium |
| HTML attribute types | Yes | `Button.tsx:7`, `Field.tsx:28` | High |
| `forwardRef<E, P>` | Yes, 4 | `Button.tsx:25`, `Field.tsx:30` | Medium |
| Type assertion (`as`) | Yes, ~10 | `session.ts:71` | Medium — handle with care |
| `any` | Yes, 53 | mostly `catch (err: any)` | A problem to fix, not a skill to learn |
| `?.` and `??` | Yes | `ProductCard.tsx:26` | High |
| `useParams<T>` | Yes, 1 | `TrackOrder.tsx:66` | Medium |
| Typed API responses | **No** | — | **Critical gap** |
| Shared domain types file | **No** | — | **Critical gap** |
| Context types | No — no Context exists | — | Not applicable |
| `enum` | No | — | Not needed |
| Your own generic functions | No | — | Nice to know |
| Discriminated unions | No | — | Should know |
| Mapped / conditional types | No | — | Not needed yet |
| `unknown`, `never`, `satisfies` | No | — | Nice to know |

---

## 8. The business entities in ShopSphere

These are the real-world things the app deals with, and where their types live today.

| Entity | Type name(s) in code | Defined in | Note |
|---|---|---|---|
| Product (catalog view) | `CatalogProduct` | `components/catalog/ProductCard.tsx:6` | The only shared, exported product type |
| Product (page-local) | `Product` | `AllProducts.tsx`, `BuyProduct.tsx`, `ProductDetailsPage.tsx`, `ProductDetailsAdmin.tsx`, `SellerPanel.tsx`, `SellerProducts.tsx`, `SellerProductDetails.tsx` | **Declared 7 separate times, with different fields** |
| Logged-in user | `SessionUser` | `lib/session.ts:15` | Shared, exported |
| User (admin view) | `User` | `AdminUserManagement.tsx:7`, `UserDetails.tsx:9` | Duplicated |
| User profile | `UserProfile` | `Profile.tsx:8` | Third variation of "a user" |
| Cart item | `CartItem` | `Cart.tsx:12`, `CartCheckout.tsx:13` | Duplicated, fields differ slightly |
| Cart | `CartData`, `Cart` | `Cart.tsx:26`, `CartCheckout.tsx:27` | Two different shapes |
| Order | `Order` | `AdminOrders.tsx`, `MyOrders.tsx`, `MyOrdersNew.tsx`, `SellerOrders.tsx`, `SellerPanel.tsx`, `Success.tsx` | **Declared 6 times** |
| Order (detail view) | `OrderData` | `OrderDetails.tsx:9` | The largest type in the project |
| Order (tracking view) | `TrackOrder` | `TrackOrder.tsx:24` | Yet another order shape |
| Order timeline | `TimelineStep` | `TrackOrder.tsx:17` | |
| Seller | `Seller` | `AdminSellerApproval.tsx:7` | |
| Promo code | `PromoCode` | `PromoManagement.tsx:8` | |
| Notification | `Notification` | `NotificationBell.tsx:7` | Has a union `type` field |
| Chat message | `Message` | `ChatWidget.tsx:5` | |
| Revenue figures | `RevenueSummary`, `MonthData` | `AdminRevenueDashboard.tsx`, `SellerRevenueDashboard.tsx` | Duplicated between admin and seller |
| Bill | `Bill` | `UserBillHistory.tsx:8` | |
| Product variants | `ColorVariant`, `StorageVariant` | `AddProduct.tsx:8`, `AddProduct.tsx:14` | |
| Admin dashboard stats | `Statistics` | `AdminUserManagement.tsx:20` | |

**There is no `Payment` or `Address` type.** Payment goes through eSewa and is handled with plain values. Delivery address is an inline nested object inside the order types, not a named type of its own.

---

## 9. The two big gaps in this codebase

You will fix these once you finish the roadmap. Knowing about them now helps you understand *why* certain concepts matter.

### Gap 1 — server responses are not typed

Today, every API call looks like this:

```ts
const response = await axios.get(`${BACKEND}/api/v1/promo/all`, { headers });
setPromoCodes(response.data.promoCodes || []);
```

`response.data` is typed `any`. That means:

- `response.data.promoCods` (typo) compiles fine and silently gives `undefined`
- if the backend renames a field, nothing warns you
- your carefully written `PromoCode` interface is never actually checked against real data

The fix is one word per call:

```ts
const response = await axios.get<{ promoCodes: PromoCode[] }>(`${BACKEND}/api/v1/promo/all`, { headers });
```

Now the typo is an error and the interface is doing real work.

### Gap 2 — domain types are copy-pasted, not shared

`Product` exists 7 times, `Order` 6 times, and the copies do not agree with each other. When the backend adds a field, you must remember to update up to seven files, and nothing tells you which ones you missed.

The fix is a single `frontend/src/types/` folder holding each entity once, imported everywhere. The project already proves this works: `CatalogProduct` in `ProductCard.tsx` is exported and reused by `Home.tsx` and the tests.

---

## 10. MUST KNOW / SHOULD KNOW / NICE TO KNOW / NOT NEEDED

### MUST KNOW

Without these you cannot read ShopSphere at all.

1. Type annotations on variables, parameters, and return values
2. Type inference — when TypeScript figures the type out on its own
3. `string`, `number`, `boolean`, and arrays
4. Object types and **nested** object types
5. **Optional properties (`?`)** — this project uses them everywhere; `OrderData` has around 30
6. `interface` and `type`, and why this codebase uses both
7. Union types, especially `Product | null`
8. Unions of fixed strings, such as `'user' | 'seller' | 'admin'`
9. Typing functions and callback props, such as `onOpen: (product: CatalogProduct) => void`
10. `useState<T>` with a type parameter
11. Typing component props
12. `ReactNode` — the type for "anything React can render"
13. Optional chaining `?.` and nullish coalescing `??`
14. Reading strict-mode errors like `Object is possibly 'null'`

### SHOULD KNOW

These make changing and extending the project far easier.

1. React event types — `FormEvent`, `ChangeEvent<HTMLInputElement>`, `MouseEvent`
2. Intersection types (`&`)
3. `Record<K, V>`
4. `Omit<T, K>`, `Partial<T>`, `Pick<T, K>`
5. React's HTML attribute types, such as `ButtonHTMLAttributes<HTMLButtonElement>`
6. `useRef<HTMLDivElement>(null)` and why `.current` may be null
7. Type assertions (`as`) and how to tell when one is lying
8. Why `catch (err: any)` is bad, and what to write instead
9. **Typing axios responses** — not used here yet, the single biggest improvement available
10. **A shared domain types file** — not present here, the second biggest
11. `keyof typeof`
12. Discriminated unions — the correct fix for `Notification.type` and order `status`

### NICE TO KNOW

Real TypeScript knowledge, but not urgent for this project.

- `forwardRef<Element, Props>` type parameters — read them, rarely write them
- `ComponentProps<typeof X>`
- Writing your own generic functions
- `unknown` and how it differs from `any`
- `satisfies`
- Type guards, such as `function isProduct(x: unknown): x is Product`

### NOT NEEDED YET

Skip these entirely for now. ShopSphere uses none of them, and learning them will not help you here.

- Conditional types (`T extends U ? A : B`)
- Mapped types (`{ [K in keyof T]: ... }`)
- Template literal types
- Declaration merging and module augmentation
- Decorators, abstract classes, `namespace`
- Variance annotations (`in` / `out`)
- `enum` — the project has none, and unions of strings are the modern replacement it already uses

---

## 11. Learning order

```text
 1. Type annotations and inference
 2. Arrays and object types
 3. Optional properties
 4. interface and type
 5. Nested objects and arrays of objects
 6. Union types and handling null
 7. Unions of fixed strings
 8. Optional chaining and nullish coalescing
 9. Functions, callbacks, return types
10. Typing React props
11. ReactNode and children
12. Typing useState
13. Typing events
14. Typing refs
15. Intersection types
16. Record, Omit, Partial
17. HTML attribute types and forwardRef
18. any, as, and reading real errors
19. Typing API responses
20. Shared domain types and discriminated unions
```

| # | Concept | Difficulty | Importance to ShopSphere | Learn these first |
|---|---|---|---|---|
| 1 | Annotations and inference | Beginner | Critical | JavaScript |
| 2 | Arrays and object types | Beginner | Critical | 1 |
| 3 | Optional properties | Beginner | Critical | 2 |
| 4 | `interface` and `type` | Beginner | Critical | 2, 3 |
| 5 | Nested and array-of-object types | Beginner | Critical | 4 |
| 6 | Unions and `T \| null` | Beginner | Critical | 4 |
| 7 | Unions of fixed strings | Beginner | High | 6 |
| 8 | `?.` and `??` | Beginner | High | 3, 6 |
| 9 | Function and callback types | Intermediate | Critical | 1, 4 |
| 10 | React props | Intermediate | Critical | 4, 9 |
| 11 | `ReactNode` and children | Intermediate | High | 10 |
| 12 | `useState<T>` | Intermediate | Critical | 6, 10 |
| 13 | Event types | Intermediate | High | 9, 10 |
| 14 | `useRef<T>` | Intermediate | Medium | 6, 12 |
| 15 | Intersection `&` | Intermediate | High | 4 |
| 16 | `Record`, `Omit`, `Partial` | Intermediate | High | 4, 7 |
| 17 | HTML attributes and `forwardRef` | Advanced | Medium | 10, 15, 16 |
| 18 | `any`, `as`, reading errors | Intermediate | Critical | 1–12 |
| 19 | Typing API responses | Intermediate | Critical | 4, 9, 18 |
| 20 | Shared types and discriminated unions | Advanced | High | 19 |

---

## 12. Detailed roadmap, level by level

The 20 concepts group into 8 teaching levels.

### Level 1 — Foundations

**Concepts:** 1, 2, 3, 8

What TypeScript is and why this project has it. Type inference versus writing types by hand. Primitives, arrays, optional values, `?.` and `??`. Also: why `npm run build` succeeds even when types are broken, and how to check them properly.

**Files:** `lib/utils.ts` (tiny and fully typed), `components/catalog/Money.tsx`

---

### Level 2 — Describing objects

**Concepts:** 4, 5, 15

`interface` versus `type`. Optional properties. Objects inside objects. Arrays of objects. Combining two types with `&`.

**Files:**
- `components/catalog/ProductCard.tsx` — `CatalogProduct`
- `pages/Cart.tsx` — `CartItem` and `CartData`
- `pages/OrderDetails.tsx` — `OrderData`, the deepest type in the project
- `components/ui/Button.tsx` — `ButtonProps` built with `&`

---

### Level 3 — Unions, fixed values, narrowing

**Concepts:** 6, 7

Union types. Unions of exact string values. Working with `T | null` under strict mode. Narrowing — how an `if` check teaches TypeScript what a value actually is at that point.

**Files:**
- `components/auth/RoleSelector.tsx` — `AccountRole`
- `components/auth/ProtectedRoute.tsx` — `role: "admin" | "seller"`
- `components/ui/Status.tsx` — `StatusTone`
- `pages/PromoManagement.tsx` — `discountType: "percentage" | "fixed"`
- `pages/AdminUserManagement.tsx` — a union used as state

---

### Level 4 — Functions and callbacks

**Concept:** 9

Parameter types, return types, optional and default parameters, callback props, `Promise<T>`, and what an `async` function really returns.

**Files:**
- `components/catalog/ProductCard.tsx:38` — `onOpen` and `onAddToCart`
- `components/operations/ActionList.tsx` — `onSelect: () => void`
- `lib/session.ts` — `login`, `refreshSession` returning `Promise<string | null>`

---

### Level 5 — React with TypeScript

**Concepts:** 10, 11, 12, 13, 14, 17

`.ts` versus `.tsx`. The three different ways this project types a component. `ReactNode`. `useState` generics. Why `useEffect` needs no type. Event types. Refs. `forwardRef`. `useParams`. And `React.FC` — used once in this codebase, and why it is no longer recommended.

**Files:** everything in `components/`, plus:
- `pages/AddProduct.tsx` — form and change events
- `components/ChatWidget.tsx` — three typed refs
- `pages/TrackOrder.tsx:66` — `useParams<{ orderId: string }>()`

---

### Level 6 — Talking to the API

**Concept:** 19

How ShopSphere calls the backend today, and exactly where the types stop. You will see that `axios.get(...)` gives back `any`, that `setProducts(response.data)` is completely unchecked, and how one type parameter closes the hole.

The data flow, and where types do and do not apply:

```text
React component
      │
      ▼
axios.get(url)                ← no type today, should be axios.get<Product[]>(url)
      │
      ▼
Express backend (JavaScript)  ← no types at all, by design
      │
      ▼
JSON response
      │
      ▼
response.data                 ← currently `any`, checks nothing
      │
      ▼
setProducts(...)              ← useState<Product[]> checks THIS step
      │
      ▼
UI renders product.name       ← typo here IS caught, because state is typed
```

The lesson: state typing already protects the second half of the flow. Response typing is what protects the first half.

**Files:** `pages/Home.tsx`, `pages/Cart.tsx`, `lib/session.ts`, `components/NotificationBell.tsx` (uses `authFetch` with `RequestInfo | URL` and `RequestInit`)

---

### Level 7 — ShopSphere domain types

**Concept:** 20 (first half)

Every business entity from section 8: what it represents, where it is defined, where it is used, why the type is needed, and what breaks without it. Plus the duplication problem, in detail, with the exact files affected.

---

### Level 8 — Utility types and safe cleanup

**Concepts:** 16, 18, 20 (second half)

`Record`, `Omit`, `Partial`, `Pick`, `keyof typeof`, `ComponentProps<typeof X>`. Then the important part: reading real TypeScript error messages, why `any` and `as` silence errors without fixing them, a tour of the 53 `any` uses in this project, and discriminated unions as the proper fix for `Notification.type` and order `status`.

**Files:** `components/ui/Button.tsx`, `components/ui/Field.tsx`, `components/ui/AsyncState.tsx`, `components/ui/sonner.tsx`, `pages/AddProduct.tsx:236`

---

## 13. How TypeScript fits the whole frontend

```text
                        ShopSphere frontend
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   Components               lib/session.ts         Domain types
   (typed well)             (typed well)           (scattered)
        │                       │                       │
   prop types              SessionUser            CatalogProduct
   state types             Promise<T|null>        Product ×7
   event types             axios interceptors     Order ×6
   ReactNode               authFetch              CartItem ×2
   forwardRef                                     PromoCode
        │                       │                 Notification
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                          TypeScript checker
                                │
                    (runs in your editor, and in
                     `npx tsc -b` — but NOT in the build)
                                │
                        Errors caught before runtime
```

Notice what is missing compared to a typical React app:

- **No Context layer.** There is no `AuthContext` or `CartContext`. Every page reads `localStorage` directly. This is why you will not find `createContext` anywhere, and why "typing Context" is not on your must-know list.
- **No API layer.** There is no `api/products.ts` with typed functions. Pages call `axios` inline. `lib/session.ts` is the only file that behaves like an API module.

Both are things you could add later. Neither is something to learn *about this codebase* right now.

---

## 14. Small things to know before you start

- **`frontend/@/components` is an empty folder** that `tsconfig.app.json` still lists in its `include`. Leftover configuration. Ignore it.
- **The backend is JavaScript.** Do not look for types there.
- **`vite-env.d.ts` is one line.** `/// <reference types="vite/client" />` — it is what makes `import.meta.env.VITE_BACKEND_URL` a known thing rather than an error.
- **Tests are typed too.** `components/catalog/catalog.test.tsx` builds a `CatalogProduct` object by hand. If the type changes, the test stops compiling. That is a feature.
- **When you hit an error you do not understand, do not reach for `any`.** Read the message. It almost always names the exact property and the exact mismatch. Level 8 covers this properly.

---

## What next

Work through the levels in order. For each one, open the listed files and read them with the concept in mind before writing any code of your own.

Say **"Start Level 1"** to begin.

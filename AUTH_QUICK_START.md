# ShopSphere - Authentication Quick Start Guide

## Accessing the New Authentication System

### For Customers (Buyers)
1. Go to `/auth-landing`
2. Click the **"Customer"** card (blue)
3. You'll be taken to `/user-auth`
4. Choose "Sign In" or "Sign Up"
5. After login, you'll be redirected to the home page `/`

**Key Features:**
- Browse products
- Add to cart
- Make purchases
- View order history and bills
- Manage account

---

### For Sellers
1. Go to `/auth-landing`
2. Click the **"Seller"** card (purple)
3. You'll be taken to `/seller-auth` (same as `/user-auth`)
4. Choose "Sign In" or "Sign Up"
5. **For Sign Up:** Provide shop name and description
6. After login, you'll be redirected to `/seller-panel`

**Key Features:**
- Manage products
- View orders from customers
- Track revenue and earnings
- Monitor low stock alerts
- Approve/manage shipments

---

### For Administrators
1. Go to `/auth-landing`
2. Click the **"Admin"** card (red)
3. You'll be taken to `/admin-auth` (admin-only)
4. Enter admin credentials
5. After login, you'll be redirected to `/admin`

**Key Features:**
- Approve/reject seller registrations
- View platform revenue and commissions
- Monitor all orders
- View all products
- Manage platform settings

---

## Complete URL Routes

### Authentication Pages
| Page | URL | Purpose |
|------|-----|---------|
| Role Selection | `/auth-landing` | Choose role before login |
| Customer/Seller Auth | `/user-auth` | Login/Signup for customers |
| Customer/Seller Auth | `/seller-auth` | Login/Signup for sellers (same component) |
| Admin Auth | `/admin-auth` | Admin-only login |
| Legacy Auth | `/auth`, `/signin`, `/signup` | Redirects to `/auth-landing` |

### Customer Routes
| Page | URL | Purpose |
|------|-----|---------|
| Home | `/` | Browse products |
| Product Details | `/product-details-page?productId={id}` | View product & checkout |
| Shopping Cart | `/cart` | Manage cart items |
| Cart Checkout | `/checkout` | Finalize cart purchase |
| My Orders | `/my-orders` | View order history |
| Bill History | `/user/bills` | View invoices |
| Payment | `/payment` | Process payment |
| Order Success | `/success/{orderId}` | Confirmation page |

### Seller Routes
| Page | URL | Purpose |
|------|-----|---------|
| Seller Panel | `/seller-panel` | Dashboard |
| My Products | `/seller-products` | Manage products |
| Product Details | `/seller-products/{id}` | Edit product |
| Seller Orders | `/seller-orders` | View customer orders |
| Revenue Dashboard | `/seller/revenue` | View earnings & metrics |

### Admin Routes
| Page | URL | Purpose |
|------|-----|---------|
| Admin Dashboard | `/admin` | Main dashboard |
| Seller Approvals | `/admin/seller-approvals` | Approve/reject sellers |
| Admin Revenue | `/admin/revenue` | Platform revenue & commissions |
| All Orders | `/admin-orders` | Monitor all orders |
| All Products | `/all-products` | View all products |

---

## Quick Start for Testing

### Test Customer Account
```
Landing Page: http://localhost:5173/auth-landing
Click: Customer Card
Sign Up: Create new account
OR
Sign In: Use existing customer email
Result: Redirected to /
```

### Test Seller Account
```
Landing Page: http://localhost:5173/auth-landing
Click: Seller Card
Sign Up: Fill seller details including shop name
OR
Sign In: Use existing seller email
Result: Redirected to /seller-panel
```

### Test Admin Account
```
Landing Page: http://localhost:5173/auth-landing
Click: Admin Card
Sign In: Enter admin credentials
Result: Redirected to /admin
```

---

## Environment Setup

Make sure your `.env` file has:
```
VITE_BACKEND_URL=http://localhost:4000
```

And your backend is running on port 4000 with these endpoints:
- `POST /v1/auth/signin`
- `POST /v1/auth/signup`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Page not found at `/auth-landing` | Make sure frontend is built and running |
| "Login failed" error | Check backend is running and accepts role parameter |
| Not redirected after login | Check localStorage for token value |
| Wrong page after login | Verify localStorage has correct isAdmin/isSeller values |
| Components not displaying | Run `npm install` to ensure dependencies exist |

---

## Architecture Overview

```
AuthLanding (Role Selection)
├── Customer → UserAuth (/user-auth) → "/" (Home)
├── Seller → UserAuth (/seller-auth) → "/seller-panel"
└── Admin → AdminAuth (/admin-auth) → "/admin"

UserAuth Component Features:
├── Customer Mode
│   ├── Sign In: Email + Password
│   └── Sign Up: Email + Password + Name
└── Seller Mode
    ├── Sign In: Email + Password
    └── Sign Up: Email + Password + Name + ShopName + ShopDescription

AdminAuth Component Features:
├── Admin-only Interface
├── No signup option
└── Security notices
```

---

## Next Steps

1. ✅ Navigate to `/auth-landing`
2. ✅ Select your role
3. ✅ Sign up or sign in
4. ✅ You're logged in!

**Questions?** Check the main [AUTHENTICATION_UPDATE.md](./AUTHENTICATION_UPDATE.md) for detailed documentation.

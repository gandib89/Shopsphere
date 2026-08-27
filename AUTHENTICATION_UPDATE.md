# ShopSphere Authentication System - Updated

## Overview
The authentication system has been redesigned with separate login pages for different user roles:
- **Customers** (User)
- **Sellers**
- **Administrators**

## New Page Structure

### 1. AuthLanding.tsx (`/auth-landing`)
**Purpose:** Landing page where users select their role before logging in

**Features:**
- Three interactive cards for role selection
- Customer (Blue) - Browse and purchase products
- Seller (Purple) - Manage store and sell products
- Admin (Red) - Manage platform and transactions
- Smooth transitions and hover effects
- Navigation to appropriate login page

**Design:**
- Full-screen background with gradient overlay
- 3-column responsive grid (1 column on mobile, 3 on desktop)
- Large icons (Lucide React: User, Store, Shield)
- "Continue" button on each card

**Routes:**
- `/auth-landing` → redirects to appropriate page

---

### 2. UserAuth.tsx (`/user-auth` & `/seller-auth`)
**Purpose:** Unified login/signup page for Customers and Sellers with toggle between roles

**Features:**
- **Role Toggle:** Switch between Customer and Seller modes
  - Customer button (Blue) with User icon
  - Seller button (Purple) with Store icon
- **Sign In Form:**
  - Email input
  - Password input
  - Role submission (based on selected mode)
- **Sign Up Form:**
  - Full Name
  - Email
  - Password + Confirm Password
  - **Additional for Sellers:**
    - Shop Name (required)
    - Shop Description (optional textarea)
- **Error Handling:** Display authentication errors
- **Loading State:** Button shows "Loading..." during submission

**Routes:**
- `/user-auth` - Customer login/signup
- `/seller-auth` - Also uses UserAuth component (router handles role selection)

**Functionality:**
```
Sign In: POST /v1/auth/signin
{
  email: string,
  password: string,
  role: "user" | "seller"
}

Sign Up: POST /v1/auth/signup
{
  email: string,
  password: string,
  name: string,
  role: "user" | "seller",
  shopName?: string (for sellers),
  shopDescription?: string (for sellers)
}
```

**Redirects:**
- After sign in as customer: `/`
- After sign in as seller: `/seller-panel`
- After sign up: Same as above

---

### 3. AdminAuth.tsx (`/admin-auth`)
**Purpose:** Dedicated admin-only login page with enhanced security messaging

**Features:**
- **Admin-Only Interface:**
  - Red/Orange color scheme for security distinction
  - Shield icon with "Admin Login" title
  - Warning banner about unauthorized access
- **Security Notice:**
  - Warning message: "Unauthorized access is prohibited"
  - Footer: "All admin activities are logged and monitored"
- **Login Fields:**
  - Admin Email
  - Password
  - No sign-up option (admins created by system)
  - Submit as admin role

**Routes:**
- `/admin-auth` - Admin login only

**Functionality:**
```
Sign In: POST /v1/auth/signin
{
  email: string,
  password: string,
  role: "admin"
}
```

**Redirects:**
- After successful sign in: `/admin`

---

## Updated App.tsx Routes

```tsx
<Route path="/auth-landing" element={<AuthLanding />} />
<Route path="/user-auth" element={<UserAuth />} />
<Route path="/seller-auth" element={<UserAuth />} />
<Route path="/admin-auth" element={<AdminAuth />} />
<Route path="/auth" element={<Auth />} /> // Redirects to /auth-landing
<Route path="/signin" element={<Auth />} /> // Redirects to /auth-landing
<Route path="/signup" element={<Auth />} /> // Redirects to /auth-landing
```

---

## User Flow Diagrams

### New User Registration
```
/auth-landing
    ↓ (Select role)
/user-auth (or /seller-auth)
    ↓ (Click "Sign Up")
    ↓ (Fill in registration form)
    ↓ (For sellers: enter shop name/description)
    ↓ (Submit)
    ↓ (Backend creates account)
    ↓ (Auto sign in)
/ (Customer) or /seller-panel (Seller)
```

### Existing User Login
```
/auth-landing
    ↓ (Select role)
/user-auth (or /seller-auth or /admin-auth)
    ↓ (Enter credentials)
    ↓ (Click "Sign In")
    ↓ (Backend verifies)
    ↓ (JWT token stored)
/ (Customer) or /seller-panel (Seller) or /admin (Admin)
```

### Admin Login
```
/auth-landing
    ↓ (Click Admin)
/admin-auth
    ↓ (Enter admin credentials)
    ↓ (Click "Sign In as Admin")
    ↓ (Backend verifies role is admin)
    ↓ (JWT token stored, isAdmin=true)
/admin
```

---

## LocalStorage Updates

After successful authentication, the following values are stored:

**For Customers:**
```javascript
{
  token: "jwt-token-string",
  isAdmin: "false",
  isSeller: "false"
}
```

**For Sellers:**
```javascript
{
  token: "jwt-token-string",
  isAdmin: "false",
  isSeller: "true"
}
```

**For Admins:**
```javascript
{
  token: "jwt-token-string",
  isAdmin: "true",
  isSeller: "false"
}
```

---

## Visual Design

### Color Scheme
- **Customer:** Blue (#2563eb) - Fresh, friendly
- **Seller:** Purple (#9333ea) - Professional, distinct
- **Admin:** Red (#dc2626) - Authority, security

### Typography
- Heading: 30px bold white text on colored background
- Labels: 14px bold gray
- Inputs: 14px with focus states (colored border)
- Helper text: Small gray text below fields

### Components Used
- **Icons:** Lucide React (User, Store, Shield, Mail, Lock, ArrowLeft, ArrowRight)
- **Styling:** Tailwind CSS with gradients and transitions
- **Background:** Full-screen with 40% black overlay
- **Cards:** White rounded-2xl with shadow

---

## Benefits of New Structure

✅ **Clear Role Separation:** Users immediately understand their access level
✅ **Improved UX:** Dedicated pages reduce confusion
✅ **Security:** Admin-specific interface with warning messages
✅ **Flexibility:** Easy to add more roles in future
✅ **Mobile-Friendly:** Responsive design for all screen sizes
✅ **Smooth Transitions:** Hover effects and animations
✅ **Error Handling:** Clear feedback on authentication failures

---

## Backend Requirements

**No changes needed.** The existing backend endpoints support:
- POST `/v1/auth/signin` with role parameter
- POST `/v1/auth/signup` with role and optional seller fields
- JWT generation and validation
- Role-based redirects in frontend based on response

---

## Testing Checklist

- [ ] Customer sign up with email/password
- [ ] Customer sign in with email/password
- [ ] Seller sign up with shop details
- [ ] Seller sign in
- [ ] Admin sign in
- [ ] Verify redirects to correct pages
- [ ] Check localStorage has correct values
- [ ] Test error messages (invalid credentials, etc.)
- [ ] Test on mobile view (responsive layout)
- [ ] Test back button navigation between pages
- [ ] Verify role toggle works in UserAuth page

---

## Future Enhancements

- [ ] Add "Forgot Password" functionality
- [ ] Add two-factor authentication for admins
- [ ] Add email verification for new accounts
- [ ] Add social login (Google, GitHub)
- [ ] Add password strength indicator
- [ ] Add account recovery options
- [ ] Add login history and device management

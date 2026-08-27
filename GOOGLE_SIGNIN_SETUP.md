# Google Sign-In Implementation Guide

## Overview
Google Sign-In has been integrated into the customer signup process. Users can now sign up with their Google account instead of creating a password.

---

## Setup Instructions

### Step 1: Create Google Cloud Project & Get Client ID

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Sign in with your Google account

2. **Create a New Project**
   - Click "Select a Project" → "New Project"
   - Name: `ShopSphere` (or any name)
   - Click "Create"

3. **Enable Google+ API**
   - In the search bar, search for "Google+ API"
   - Click on it and select "Enable"

4. **Create OAuth 2.0 Credentials**
   - Click "Create Credentials" → "OAuth 2.0 Client ID"
   - If prompted, click "Configure OAuth consent screen" first
   - Select "External" → Fill in app name "ShopSphere"
   - Add your email as support email
   - Click "Save and Continue" through all steps

5. **Create OAuth Client ID**
   - Go back to "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: "Web application"
   - Name: "ShopSphere Frontend"
   - Add Authorized JavaScript origins:
     ```
     http://localhost:5173
     http://localhost:3000
     (add your production domain later)
     ```
   - Add Authorized redirect URIs:
     ```
     http://localhost:5173
     http://localhost:3000
     (add your production domain later)
     ```
   - Click "Create"

6. **Copy Your Client ID**
   - You'll see a modal with your Client ID
   - Copy the long string that looks like: `XXXXX.apps.googleusercontent.com`

---

### Step 2: Add Client ID to Frontend

**File:** `/Users/sirriee/Downloads/ShopSphere/frontend/src/App.tsx`

Find this line (around line 32):
```tsx
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';
```

Replace `YOUR_GOOGLE_CLIENT_ID_HERE` with your copied Client ID:
```tsx
const GOOGLE_CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com';
```

---

### Step 3: Add Client ID to Backend

**File:** `/Users/sirriee/Downloads/ShopSphere/backend/config/config.env`

Find this line:
```dotenv
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE
```

Replace with your Client ID:
```dotenv
GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
```

---

## How It Works

### Customer Signup Flow

1. User navigates to `/user-auth`
2. Clicks "Sign Up" tab (if not already selected)
3. Sees regular signup form + "Or continue with" Google button
4. Clicks Google button
5. Google popup appears
6. User selects their Google account
7. System automatically:
   - Gets first name, last name, email from Google
   - Checks if user exists in database
   - Creates new user if not exists
   - Logs user in
   - Redirects to home page

### Backend Processing

1. Frontend sends Google token to: `POST /api/v1/auth/google-signin`
2. Backend verifies token with Google
3. Extracts user info from verified token
4. Creates/finds user in database
5. Generates JWT token
6. Returns same response as regular login

### Database Changes

**User Schema Updated:**
- Added `googleId` field (optional)
- Made `phone` field optional (not needed for Google users)
- Made `password` field optional (not needed for Google users)

---

## Features

✅ **Automatic Account Creation**
- User account created automatically on first Google sign-in
- No manual form filling required

✅ **Auto Login**
- Returning users automatically logged in
- No duplicate accounts for same email

✅ **Security**
- Google token verified server-side
- JWT generated for session management
- Only available for customer signup (not seller/admin)

✅ **Seamless Integration**
- Google button appears below regular signup form
- Matches site design and styling
- Works on mobile and desktop

---

## Testing

### Test Google Sign-In Locally

1. **Start backend and frontend:**
   ```bash
   # Terminal 1 - Backend
   cd /Users/sirriee/Downloads/ShopSphere/backend
   npm run dev

   # Terminal 2 - Frontend
   cd /Users/sirriee/Downloads/ShopSphere/frontend
   npm run dev
   ```

2. **Navigate to signup:**
   - Go to `http://localhost:5173/auth-landing`
   - Click "Customer" card
   - Click "Sign Up" button

3. **Test Google Sign-In:**
   - See "Or continue with Google" button below submit
   - Click Google button
   - Select your test Google account
   - Should be redirected to home page (/)
   - Check localStorage has `token` and auth flags

### Test Regular Signup Still Works

- Sign up with regular form should still work normally
- Both methods should create user and log them in

---

## API Endpoint

### Google Sign-In Endpoint

**POST** `/api/v1/auth/google-signin`

**Request:**
```json
{
  "token": "google_id_token_here"
}
```

**Response:**
```json
{
  "message": "Google Sign-In successful",
  "token": "jwt_token_here",
  "admin": false,
  "seller": false,
  "userId": "user_id_here"
}
```

**Error Response:**
```json
{
  "message": "Google Sign-In failed",
  "error": "error_details"
}
```

---

## Production Checklist

Before deploying to production:

- [ ] Replace `YOUR_GOOGLE_CLIENT_ID_HERE` in frontend/src/App.tsx
- [ ] Replace `YOUR_GOOGLE_CLIENT_ID_HERE` in backend/config/config.env
- [ ] Add production domain to Google Cloud OAuth settings
- [ ] Test Google Sign-In on production domain
- [ ] Verify HTTPS is enabled
- [ ] Test both regular and Google signup methods

---

## Troubleshooting

### "Google Sign-In failed" Error

**Problem:** Button clicks but nothing happens or error appears

**Solutions:**
- Verify Client ID is correctly added to both frontend and backend
- Check browser console for error messages
- Ensure backend is running and accessible
- Verify GOOGLE_CLIENT_ID environment variable is loaded in backend

### "This site isn't verified" or Domain Error

**Problem:** Google shows domain not registered error

**Solutions:**
- Add domain to Google Cloud Console OAuth settings
- Authorized JavaScript origins must include your domain
- Wait 5-10 minutes for Google to process changes

### "Token verification failed"

**Problem:** Backend returns token verification error

**Solutions:**
- Verify google-auth-library package is installed
- Check GOOGLE_CLIENT_ID matches the one in Google Cloud Console
- Ensure jwt.io token is valid and not expired
- Check backend logs for detailed error

### User Created but Not Logged In

**Problem:** User signup succeeds but doesn't redirect

**Solutions:**
- Check if token is being saved to localStorage
- Verify response contains `token` field
- Check browser console for JS errors
- Ensure redirect URL (/) is accessible

---

## File Changes Made

1. **Backend:**
   - `controller/auth.js` - Added `googleSignIn` export
   - `routes/authRoute.js` - Added POST `/google-signin` route
   - `models/userSchema.js` - Added `googleId` field, made phone/password optional
   - `config/config.env` - Added GOOGLE_CLIENT_ID

2. **Frontend:**
   - `src/App.tsx` - Added GoogleOAuthProvider wrapper, GOOGLE_CLIENT_ID
   - `src/pages/UserAuth.tsx` - Added GoogleLogin button, handlers

3. **Packages Installed:**
   - Frontend: `@react-oauth/google`
   - Backend: `google-auth-library`

---

## Security Notes

✅ **Token Validation**
- All Google tokens verified server-side with Google
- Frontend token never trusted directly

✅ **JWT Generation**
- Server generates JWT after token verification
- Same security as regular login

✅ **User Data**
- Only email and names extracted from Google token
- No sensitive data stored

✅ **Account Linking**
- If user signs up with email, then tries Google with same email
- System links Google ID to existing account automatically
- Prevents duplicate accounts

---

## Future Enhancements

- [ ] Add Google Sign-In for existing users (Sign In tab)
- [ ] Add option to link Google account to existing password account
- [ ] Add disconnect/unlink Google account feature
- [ ] Add Google Sign-In for seller signup
- [ ] Add sign-in with other providers (GitHub, Facebook, etc.)


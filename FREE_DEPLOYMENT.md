# Complete Free Production Stack Deployment Guide
(Backend + Frontend + Database)

## GOAL
Deploy full chess platform using:
*   **Render** (Backend Node.js WebSocket server)
*   **Supabase** (Database)
*   **Vercel** (Frontend)

---

## PHASE 1 — DATABASE SETUP (SUPABASE)

1.  **Create Supabase project** (Free tier) at [supabase.com](https://supabase.com/).
2.  **Create PostgreSQL tables**:
    Go to the SQL Editor in your Supabase dashboard and run the following commands to create the `Users` and `Matches` tables.

    ```sql
    -- Users Table
    CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email TEXT UNIQUE,
        username TEXT UNIQUE,
        rating INTEGER DEFAULT 1200,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
    );

    -- Matches Table
    CREATE TABLE matches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        white_player_id UUID REFERENCES users(id),
        black_player_id UUID REFERENCES users(id),
        result TEXT,
        pgn TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
    );
    ```

3.  **Enable Row Level Security (RLS)** (if auth is used).
4.  **Copy Credentials**:
    Go to **Project Settings -> API** and copy:
    *   `Project URL` (SUPABASE_URL)
    *   `Project API keys -> anon public` (SUPABASE_ANON_KEY)

---

## PHASE 2 — BACKEND DEPLOYMENT (RENDER)

1.  **Push backend code** to a GitHub repository.
2.  **Verify Port Configuration**:
    Ensure your `server/index.js` file uses the environment port:
    ```javascript
    const PORT = process.env.PORT || 3000;
    ```
3.  **Verify WebSocket handling**: Ensure WebSocket upgrade handling is enabled in your server code.
4.  **Deploy on Render**:
    *   Go to [render.com](https://render.com/) and create a **New Web Service**.
    *   Connect your GitHub repository.
    *   **Runtime**: `Node`
    *   **Build Command**: `npm install`
    *   **Start Command**: `node index.js` (or whatever command starts your server)
5.  **Environment Variables**:
    In the Render dashboard for your Web Service, go to **Environment** and add the following Environment Variables:
    *   `NODE_ENV`: `production`
    *   `PORT`: `10000` (Render explicitly exposes PORT 10000 as a default, though it sets it dynamically, `server.listen(port)` is enough)
    *   `SUPABASE_URL`: (Your copied Supabase URL)
    *   `SUPABASE_KEY`: (Your copied Supabase Anon Key)
6.  **Copy Backend URL**:
    After deployment is complete, copy the provided URL:
    `https://your-backend-name.onrender.com`
7.  **Test Deployment**:
    Ensure the backend is running. If you have a health endpoint:
    `https://your-backend-name.onrender.com/health`
    Confirm:
    *   Server is running
    *   WebSockets are connecting
    *   No crashes in Render logs

---

## PHASE 3 — FRONTEND DEPLOYMENT (VERCEL)

1.  **Update Socket URL**:
    In your frontend code (e.g., `client/src/network/SocketClient.js` or `.env`), replace the local backend URL with the Render backend URL:
    ```javascript
    // Example
    const SOCKET_URL = "https://your-backend-name.onrender.com";
    ```
2.  **Push frontend code** to a GitHub repository.
3.  **Deploy on Vercel**:
    *   Go to [vercel.com](https://vercel.com/) and create a **New Project**.
    *   Import your GitHub repository.
    *   **Framework**: `Vite` or `React` (Vercel usually auto-detects this).
    *   Click **Deploy**.
4.  **Copy Frontend URL**:
    After deployment is complete, copy the provided URL:
    `https://your-frontend-name.vercel.app`

---

## PHASE 4 — CONNECT EVERYTHING

1.  **Open frontend URL** in your browser.
2.  **Confirm**:
    *   Backend API is responding.
    *   WebSocket connection is successful (Check network tab in browser dev tools -> WS).
    *   Users can join matches.
    *   Moves sync in real-time.
    *   Matches save correctly to Supabase.

---

## PHASE 5 — BASIC PRODUCTION CHECKLIST

*   [ ] `NODE_ENV=production` is enabled on the backend.
*   [ ] Supabase is connected and data is flowing.
*   [ ] No console errors in the browser.
*   [ ] CORS is configured properly on the backend to accept requests from your Vercel URL.
*   [ ] Backend sleep/wake delay is acceptable (Render free tier spins down after 15 minutes of inactivity).

---

## FINAL ARCHITECTURE

User
 ↓
Frontend (Vercel Free)
 ↓
Backend (Render Free Node Web Service)
 ↓
Database (Supabase Free PostgreSQL)

---

## RESULT

✔ Fully deployed full-stack chess platform
✔ Real-time WebSocket backend
✔ Persistent database
✔ HTTPS enabled automatically
✔ Zero infrastructure cost
✔ Ready for MVP users

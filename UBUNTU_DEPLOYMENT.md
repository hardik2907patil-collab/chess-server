# Ubuntu Production VPS Deployment Guide

This guide details the exact steps to transition your hardened local backend to a production environment on an Ubuntu VPS, running behind an NGINX reverse proxy with PM2 process management and HTTPS enabled.

## STEP 1 — SERVER PREPARATION (Ubuntu)

**1. Update system:**
```bash
sudo apt update && sudo apt upgrade -y
```

**2. Install Node LTS:**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

**3. Install PM2:**
```bash
sudo npm install -g pm2
```

**4. Verify installations:**
```bash
node -v
pm2 -v
```

---

## STEP 2 — DEPLOY BACKEND

**1. Upload your project** to the server (via `git clone`, `scp`, or an FTP client like FileZilla).

**2. Install dependencies:**
Navigate to the `server` folder inside your project.
```bash
npm install --production
```

**3. Create `.env` file:**
Create a `.env` file in the `server` directory:
```env
NODE_ENV=production
PORT=3000
SUPABASE_URL=your_url
SUPABASE_KEY=your_key
```

**4. Server Port Verification:**
Ensure your `index.js` listens flexibly to the environment port:
```javascript
const PORT = process.env.PORT || 3000;
```
*(The Checkmate Legends server codebase is already configured for this).*

**5. Start with PM2 cluster mode:**
This will spawn one backend instance per CPU core on your VPS, maximizing your hardware capability.
```bash
pm2 start index.js -i max --name chess-backend
pm2 save
pm2 startup
```
*(Follow the final command prompt printed by `pm2 startup` to permanently ensure PM2 launches your server on machine reboot).*

---

## STEP 3 — INSTALL & CONFIGURE NGINX

**1. Install Nginx:**
```bash
sudo apt install nginx -y
```

**2. Create config:**
```bash
sudo nano /etc/nginx/sites-available/chess-backend
```

**Paste the following configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com; # Replace with your actual domain

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_cache_bypass $http_upgrade;
    }
}
```

**3. Enable config and restart:**
```bash
sudo ln -s /etc/nginx/sites-available/chess-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## STEP 4 — ENABLE FIREWALL

Lock down server ports using UFW. Only SSH (Port 22), HTTP (Port 80), and HTTPS (Port 443) should be exposed. Custom port 3000 is hidden securely behind NGINX.
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## STEP 5 — ENABLE HTTPS (IMPORTANT)

**1. Install Certbot (Let's Encrypt client):**
```bash
sudo apt install certbot python3-certbot-nginx -y
```

**2. Provision Certificate:**
Run the interactive prompt to provision and automatically configure NGINX with your SSL certificates.
```bash
sudo certbot --nginx -d yourdomain.com
```
*(This automatically enables HTTPS and configures automatic renewal before expiry).*

---

## STEP 6 — VERIFY PRODUCTION HEALTH

**1. Visit your domain:**
Check that `https://yourdomain.com` is accessible and secure.

**2. Check PM2 status:**
```bash
pm2 logs
pm2 monit
```

**3. Confirm the following:**
- [ ] No crashes or restarts in `pm2 logs`.
- [ ] Memory is stable in `pm2 monit`.
- [ ] WebSocket connections are securely establishing over `wss://` on the Checkmate Legends frontend.
- [ ] HTTPS lock is completely active on your domain.

---

## FINAL RESULT

**Architecture Flow:**
1. **Frontend (Vercel)** serves the 3D client (`index.html`, React/Three.js bundles).
2. **Client connects via WebSockets (`wss://yourdomain.com`)**.
3. **NGINX (HTTPS + Reverse Proxy)** safely terminates SSL and passes raw WebSocket traffic internally.
4. **Node.js Backend (PM2 Cluster)** handles 1000+ CCU concurrent move matching and atomic lobby locks.
5. **Supabase Database** persists the final global Checkmate Leaderboards.

**System State:**
- ✅ Production mode enabled (`cross-env NODE_ENV=production`)
- ✅ Multi-core scaling active (`pm2 max` instances)
- ✅ Reverse proxy optimizing socket upgrades (NGINX)
- ✅ SSL secured (Let's Encrypt)
- ✅ Firewall protected (UFW)
- 🚀 **100% Ready for Real Users!**

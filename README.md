# Bayt Al Bun — Full‑Stack Coffee Website

Arabic RTL coffee-shop website with a real Node.js backend, online ordering, admin dashboard, and Neon PostgreSQL database.

## Features

- Responsive Arabic landing page.
- Multi-item shopping/order cart.
- Pickup or delivery orders.
- Server-side price calculation and validation.
- Orders stored in Neon PostgreSQL.
- Contact messages stored in PostgreSQL.
- Newsletter subscriptions stored in PostgreSQL with duplicate protection.
- Admin dashboard at `/admin`.
- Order statuses: pending, preparing, ready, completed, cancelled.
- Basic rate limiting and parameterized SQL queries.
- Render-ready Node.js web service.

## Requirements

- Node.js 20+
- Neon PostgreSQL `DATABASE_URL`

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Edit `.env` before `npm start`:

```env
PORT=3000
HOST=0.0.0.0
DATABASE_URL=YOUR_NEON_CONNECTION_STRING
ADMIN_USER=admin
ADMIN_PASSWORD=CHANGE_THIS_TO_A_STRONG_PASSWORD
```

Open:

- Site: `http://127.0.0.1:3000`
- Admin: `http://127.0.0.1:3000/admin`
- Health check: `http://127.0.0.1:3000/api/health`

## Render deployment

Create a **Web Service** connected to the GitHub repository.

- Build Command: `npm install`
- Start Command: `node server.js`
- Environment Variables: `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`

Do not commit `.env` or database credentials to GitHub.

# Eagle Eye SafDrive - Customer Feedback Management System

A complete, production-ready, mobile-first Customer Feedback Management System for **EAGLE EYE SAFDRIVE PVT LTD**.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS v4 |
| Backend | Node.js, Express.js |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Storage | Supabase Storage (signatures, PDFs) |
| PDF | jsPDF |
| Forms | React Hook Form + Zod |
| Signatures | react-signature-canvas |
| Icons | Lucide React |

## Project Structure

```
feedback/
├── frontend/                # React + Vite app
│   ├── public/
│   │   └── logo.png         # Eagle Eye logo
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # API client, Supabase client
│   │   ├── pages/           # Page components
│   │   │   ├── admin/       # Admin dashboard pages
│   │   │   ├── FeedbackForm.jsx
│   │   │   └── SuccessPage.jsx
│   │   ├── schemas/         # Zod validation schemas
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .env.example
│   └── package.json
├── backend/                 # Express.js API
│   ├── src/
│   │   ├── middleware/      # Auth, validation, rate limiting
│   │   ├── routes/          # API route handlers
│   │   ├── services/        # PDF generator, Supabase client
│   │   ├── config.js
│   │   └── index.js
│   ├── .env.example
│   └── package.json
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
└── README.md
```

## Prerequisites

- **Node.js** v18+
- **npm** v9+
- **Supabase** account (free tier works)

## Setup Instructions

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migration:
   - Copy contents of `supabase/migrations/001_initial_schema.sql`
   - Execute in the SQL Editor
3. Create storage buckets:
   - Go to **Storage** → **New Bucket**
   - Create `signatures` bucket (Private)
   - Create `pdfs` bucket (Private)
   - Create `assets` bucket (Public) — upload `logo.png` here for PDF generation
4. Set up storage policies (run in SQL Editor):
   ```sql
   -- Signatures bucket
   CREATE POLICY "Service role full access to signatures"
     ON storage.objects FOR ALL TO service_role
     USING (bucket_id = 'signatures')
     WITH CHECK (bucket_id = 'signatures');

   -- PDFs bucket
   CREATE POLICY "Service role full access to pdfs"
     ON storage.objects FOR ALL TO service_role
     USING (bucket_id = 'pdfs')
     WITH CHECK (bucket_id = 'pdfs');
   ```
5. Create an admin user:
   - Go to **Authentication** → **Users** → **Add User**
   - Create with email/password
   - Copy the user's UUID
   - Insert into admin_users table:
   ```sql
   INSERT INTO admin_users (id, email, full_name, role)
   VALUES ('USER-UUID-HERE', 'admin@eagleeye.com', 'Admin Name', 'admin');
   ```
6. Get your API keys from **Settings** → **API**:
   - Project URL
   - `anon` (public) key
   - `service_role` (secret) key

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npm run dev
```

### 3. Frontend Setup

```bash
cd frontend
cp .env.example .env
# Edit .env with your Supabase URL and anon key
npm install
npm run dev
```

### 4. Access the Application

- **Customer Form**: http://localhost:5173
- **Admin Login**: http://localhost:5173/admin/login
- **Admin Dashboard**: http://localhost:5173/admin/dashboard
- **Backend API**: http://localhost:3001

## Environment Variables

### Backend (`.env`)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3001) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (SECRET) |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `CORS_ORIGIN` | Frontend URL for CORS |

### Frontend (`.env`)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `VITE_API_URL` | Backend API URL (default: /api via proxy) |

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/feedback` | Submit customer feedback |
| `GET` | `/api/feedback/:feedbackId/pdf` | Download feedback PDF |
| `GET` | `/api/health` | Health check |

### Admin (requires Bearer token)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/stats` | Dashboard statistics |
| `GET` | `/api/admin/feedback` | List feedback (search/filter/paginate) |
| `GET` | `/api/admin/feedback/:id` | Individual feedback detail |
| `GET` | `/api/admin/feedback/:id/pdf` | Download PDF (admin) |
| `GET` | `/api/admin/export` | Export filtered records as CSV |

## Deployment

### Frontend (Vercel/Netlify)

1. Set environment variables in your hosting dashboard
2. Build command: `npm run build`
3. Output directory: `dist`
4. Add redirect rule: `/* → /index.html` (for SPA routing)

### Backend (Railway/Render/Fly.io)

1. Set environment variables
2. Start command: `npm start`
3. Ensure `CORS_ORIGIN` points to your frontend domain

## Security Features

- ✅ Supabase Row Level Security (RLS)
- ✅ Server-side JWT verification for admin routes
- ✅ Rate limiting on feedback submissions (5/15min)
- ✅ Global rate limiting (100 req/15min)
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ Input validation with Zod (frontend + backend)
- ✅ Service role key never exposed to frontend
- ✅ Private storage buckets for signatures/PDFs
- ✅ Signed URLs for secure file access

## License

Proprietary - Eagle Eye SafDrive Pvt Ltd

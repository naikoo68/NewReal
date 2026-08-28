# My Study Guide — Backend API

REST API for the My Study Guide platform, built with **Node.js + Express + MongoDB (Mongoose)**, JWT authentication, role-based authorization, and Cloudinary uploads.

## Tech Stack

- **Express 4** — HTTP server & routing
- **MongoDB + Mongoose 8** — database & ODM
- **JWT (jsonwebtoken)** — stateless auth
- **bcryptjs** — password hashing
- **Cloudinary + Multer** — image/file uploads
- **helmet, cors, express-rate-limit, morgan** — security & logging

## Getting Started

```bash
cd backend
npm install
cp .env.example .env        # then fill in the values
npm run seed                # optional: load sample data
npm run dev                 # starts on http://localhost:5000
```

> Requires a running MongoDB instance (local or MongoDB Atlas). Set `MONGO_URI` in `.env`.

Seeded credentials:
- Admin: `admin@mystudyguide.com` / `admin123`
- Student: `student@mystudyguide.com` / `student123`

## Project Structure

```
src/
├── config/        # db & cloudinary configuration
├── controllers/   # request handlers (business logic)
├── middleware/    # auth (protect/authorize) & error handling
├── models/        # Mongoose schemas
├── routes/        # Express routers
├── utils/         # token generation & seed script
├── app.js         # express app (middleware + routes)
└── server.js      # entry point (connects DB, starts server)
```

## API Overview

### Auth — `/api/auth`
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Public | Register + issue email verification token |
| POST | `/login` | Public | Email/password login |
| POST | `/google` | Public | Google OAuth login |
| GET | `/verify-email/:token` | Public | Verify email |
| POST | `/forgot-password` | Public | Request reset link |
| POST | `/reset-password/:token` | Public | Set new password |
| GET | `/me` | Auth | Current user |

### Content — `/api`
| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/subjects` | Public |
| POST/PUT/DELETE | `/subjects/:id` | Admin |
| GET | `/subjects/:subjectId/sessions` | Public |
| POST/PUT/DELETE | `/sessions/:id` | Admin |
| GET | `/sessions/:sessionId/questions` | Public (answers hidden) |
| POST | `/questions` / `/questions/bulk` | Admin |
| PUT/DELETE | `/questions/:id` | Admin |

### Test Series — `/api/tests`
| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/` (`?category=`) | Public |
| GET | `/:id` | Auth |
| POST | `/:id/submit` | Auth |
| POST/PUT/DELETE | `/:id` | Admin |
| PATCH | `/:id/publish` | Admin |

### Users — `/api/users` (Admin)
`GET /` · `PATCH /:id/status` · `PATCH /:id/plan` · `POST /:id/reset-password`

### Analytics
`GET /api/admin/analytics` (Admin) · `GET /api/me/dashboard` (Auth) · `GET /api/leaderboard` (Public)

### Uploads
`POST /api/upload` (Admin) — multipart `file`, returns Cloudinary URL.

## Auth & Roles

Send the JWT as `Authorization: Bearer <token>`.
- `protect` middleware validates the token and blocks suspended accounts.
- `authorize("admin")` restricts admin-only routes.

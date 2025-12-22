## CityFix Server – Backend API

CityFix Server is the backend API for the CityFix application, a platform for citizens and city staff to **report, track, and resolve urban issues**.  
It provides RESTful endpoints for user management, premium subscription & billing, and a full issue lifecycle (creation, assignment, and status tracking) using **Node.js, Express, MongoDB, and Stripe**.

- **Live API Base URL**: `https://cityfix-report-track-resolve-server-production.up.railway.app/`

---

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express (ES Modules)
- **Database**: MongoDB (via `mongodb` driver, using `MongoClient` and `ObjectId`)
- **ORM/Driver**: Native MongoDB driver (collections: `users`, `issues`, `payments`)
- **Payments**: Stripe Checkout (`stripe` server SDK, `@stripe/stripe-js` for the client)
- **Environment Management**: `dotenv`
- **CORS & JSON Parsing**: `cors`, `express.json`
- **Dev Tooling**: `nodemon` (via `npm run dev`)

---

## Project Structure

```text
CityFix Server/
├─ package.json
└─ src/
   └─ index.js        # Main Express app, DB init, and all route handlers
```

All application logic and routes are currently implemented in `src/index.js`.

---

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- A MongoDB Atlas (or compatible) connection
- A Stripe account with a secret key

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root with (at least) the following variables:

```bash
PORT=5000                     # Optional, defaults to 5000
CLIENT=http://localhost:5173  # Frontend base URL for Stripe return URLs

DB_USER=yourMongoUser
DB_PASS=yourMongoPassword
DB_NAME=yourDatabaseName

STRIPE_SECRET_KEY=sk_test_...

ADMIN_EMAIL=admin@example.com # Email that should automatically receive "admin" role
```

> **Note**: The MongoDB connection URI is constructed internally as:
> `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.wemtzez.mongodb.net/${DB_NAME}?retryWrites=true&w=majority`

### Running the Server

```bash
# Production-style run
npm start

# Development with auto-reload
npm run dev
```

By default the server listens on `http://localhost:5000` (or the `PORT` you configured).  
The root route responds with:

```text
CityFix API Active 🟢
```

---

## API Overview

All endpoints below are relative to the API base URL:

- Local: `http://localhost:5000`
- Production: `https://cityfix-report-track-resolve-server-production.up.railway.app/`

### Health

- **GET `/`**  
  Returns a simple text response to indicate the API is running.

---

## Authentication & Users

> There is no token-based auth or password management in this codebase; users are identified by email and roles.

### Register / Upsert User

- **POST `/users`**
- **Body**:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "image": "https://...",
  "role": "citizen"        // optional, will be overridden if email === ADMIN_EMAIL
}
```

- **Behavior**:
  - If `email` is missing → `400 { "message": "Email Required" }`.
  - If a user with that email already exists → existing user document is returned.
  - Otherwise, a new user document is created with:
    - `role` = `"admin"` if `email === ADMIN_EMAIL`, else `"citizen"`.
    - `status` = `"active"`.
    - `premium` = `false`.
    - `createdAt` = current date.

- **Success Response**:

```json
{
  "insertedId": "<mongo-id>",
  "role": "citizen"
}
```

### Get User by Email

- **GET `/users/:email`**
- **Response**:
  - If user exists → full user document from MongoDB.
  - If no user is found → a default object:

```json
{
  "email": "user@example.com",
  "role": "citizen",
  "premium": false,
  "status": "active"
}
```

---

## Payments & Premium Subscription (Stripe)

### Create Stripe Checkout Session

- **POST `/create-checkout-session`**
- **Body**:

```json
{
  "email": "user@example.com"
}
```

- **Behavior**:
  - Checks `users` collection; if `premium === true` → `400 { "error": "User already Premium!" }`.
  - Creates a Stripe Checkout session:
    - `mode`: `"payment"`
    - `customer_email`: `email`
    - `currency`: `"bdt"`
    - Single line item:
      - Name: `"CityFix Premium Subscription 🚀"`
      - Amount: `1000 * 100` (i.e. 1000 BDT in smallest unit)
    - `success_url`: `${CLIENT}/payment-success?session_id={CHECKOUT_SESSION_ID}`
    - `cancel_url`: `${CLIENT}/payment-cancel`

- **Success Response**:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

### Get Checkout Session Details

- **GET `/checkout-session/:id`**
- **Path Param**: Stripe session id
- **Response**:
  - On success → raw Stripe session object.
  - On failure → `404 { "error": "Session not found" }`.

### Mark Payment Success & Upgrade User

- **POST `/payment/success`**
- **Body**:

```json
{
  "email": "user@example.com",
  "session_id": "cs_test_..."
}
```

- **Behavior**:
  - Validates that both `email` and `session_id` are present.
  - Updates `users` collection:
    - Sets `premium: true` for the given `email`.
  - Upserts a document in `payments` collection matching `{ email }`:
    - `type`: `"premium"`
    - `method`: `"stripe"`
    - `session_id`
    - `amount`: `1000`
    - `currency`: `"BDT"`
    - `status`: `"paid"`
    - `date`: current date.

- **Success Response**:

```json
{ "success": true }
```

### Get User Payments

- **GET `/payments/user/:email`**
- Returns a list of payments for the given user, sorted by `date` descending.

### Admin – All Payments

- **GET `/admin/payments`**
- Returns all payment documents sorted by `date` descending.

### Admin – Payments Summary

- **GET `/admin/payments/summary`**
- **Behavior**:
  - Aggregates all `payments` with `{ type: "premium", status: "paid" }` to compute total revenue.
  - Counts number of premium users (`users` with `premium: true`).

- **Response**:

```json
{
  "totalRevenue": 5000,
  "premiumUsers": 42
}
```

---

## Admin – User Management & Dashboard

> These endpoints assume that authorization is enforced at the API gateway or client layer; no auth middleware is present in this code.

### List All Users

- **GET `/admin/users`**
- Returns all users, sorted by `createdAt` descending.

### Update User Role

- **PATCH `/admin/users/role/:id`**
- **Body**:

```json
{ "role": "staff" }
```

- **Effect**:
  - Updates `users._id == :id` with the provided `role`.

### Update User Status

- **PATCH `/admin/users/status/:id`**
- **Body**:

```json
{ "status": "active" }
```

- **Effect**:
  - Updates `status` field for specified user.

### Admin Dashboard Stats

- **GET `/admin/stats`**
- **Response**:

```json
{
  "totalUsers": 120,
  "totalStaff": 10,
  "totalIssues": 250,
  "pendingIssues": 30,
  "inProgressIssues": 50,
  "resolvedIssues": 170
}
```

The numbers are computed via MongoDB `countDocuments` on the `users` and `issues` collections.

---

## Staff & Issues

### List Staff Users

- **GET `/staff`**
- Returns all users with `role: "staff"`.

### Get Issue Count for a Reporter

- **GET `/issues/count/:email`**
- **Response**:

```json
{ "total": 5 }
```

### List Issues for a Specific User

- **GET `/issues/user/:email`**
- Returns all issues where `reporterEmail === :email`, sorted by `createdAt` descending.

### Paginated & Filtered Issue List

- **GET `/issues`**
- **Query Parameters**:
  - `page` (number, default: `1`)
  - `limit` (number, default: `6`)
  - `category` (optional)
  - `status` (optional)
  - `priority` (optional)
  - `search` (optional; searches `title`, `location`, `category` case-insensitively)

- **Response**:

```json
{
  "total": 100,
  "issues": [
    {
      "_id": "...",
      "title": "...",
      "description": "...",
      "reporterEmail": "...",
      "reporterPremium": false,
      "category": "...",
      "location": "...",
      "image": "",
      "priority": "normal",
      "status": "pending",
      "assignedStaff": null,
      "upvotes": [],
      "createdAt": "2025-01-01T00:00:00.000Z",
      "timeline": [
        {
          "status": "pending",
          "message": "Issue created",
          "by": "user@example.com",
          "time": "2025-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

### Get Single Issue

- **GET `/issues/:id`**
- **Behavior**:
  - Finds by MongoDB `_id`.
  - If not found → `404 { "message": "Not found" }`.
  - If invalid ObjectId → `400 { "message": "Invalid ID" }`.

### Create Issue

- **POST `/issues`**
- **Body** (minimal example):

```json
{
  "title": "Pothole on Main Street",
  "description": "Large pothole near the intersection.",
  "reporterEmail": "user@example.com",
  "category": "Road",
  "location": "Main Street, Ward 3",
  "image": "https://...",         // optional
  "priority": "high"              // optional, defaults to "normal"
}
```

- **Behavior**:
  - Looks up the reporter user by `reporterEmail` to set `reporterPremium`.
  - Inserts issue with:
    - `status`: `"pending"`
    - `assignedStaff`: `null`
    - `upvotes`: `[]`
    - `createdAt`: `new Date()`
    - `timeline`: one initial entry (`"Issue created"`).

- **Success Response**:

```json
{ "insertedId": "<mongo-id>" }
```

### List Issues Assigned to a Staff Member

- **GET `/issues/staff/:email`**
- Returns issues where `assignedStaff.email === :email`, sorted by `createdAt` descending.

### Assign Staff to Issue

- **PATCH `/issues/assign/:id`**
- **Body** (shape is flexible; stored as-is in `assignedStaff`):

```json
{
  "email": "staff@example.com",
  "name": "Staff Name"
}
```

- **Behavior**:
  - Sets `assignedStaff` to the request body.
  - Appends a new entry to `timeline`:
    - `status`: `"assigned"`
    - `message`: `Assigned to <name>`
    - `by`: `"admin"`
    - `time`: current date.

### Update Issue Status

- **PATCH `/issues/status/:id`**
- **Body**:

```json
{
  "status": "in progress",   // or "resolved", "completed", etc.
  "by": "staff@example.com"
}
```

- **Behavior**:
  - Updates the `status` field of the issue.
  - Pushes a new entry to `timeline` reflecting the status change.

- **Success Response**:

```json
{ "success": true }
```

---

## Error Handling

The API uses straightforward HTTP status codes:

- `200` – Successful operations.
- `400` – Bad request (e.g., missing fields, invalid id).
- `404` – Resource not found.
- `500` – Internal server error (e.g., DB or Stripe errors).

Error responses are simple JSON objects with either a `message` or `error` field, e.g.:

```json
{ "error": "Stripe session failed" }
```

---

## Deployment Notes

- The app is production-deployed to Railway:
  - **Base URL**: `https://cityfix-report-track-resolve-server-production.up.railway.app/`
- The server only starts listening after a successful MongoDB connection (`initDB()`).
- Make sure all required environment variables are configured in your hosting provider before deploying.

---

## License

This project is licensed under the **ISC License** as specified in `package.json`.



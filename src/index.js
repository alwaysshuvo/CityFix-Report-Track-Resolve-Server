import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import Stripe from "stripe";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// ========================
// Middleware
// ========================
app.use(cors());
app.use(express.json());

// ========================
// Stripe Init
// ========================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ========================
// MongoDB Setup
// ========================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wemtzez.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;
let issuesCollection;
let paymentsCollection;

async function initDB() {
  await client.connect();
  const db = client.db(process.env.DB_NAME);

  usersCollection = db.collection("users");
  issuesCollection = db.collection("issues");
  paymentsCollection = db.collection("payments");

  console.log("🔥 MongoDB Connected");
  app.listen(port, () =>
    console.log(`🚀 Server running → http://localhost:${port}`)
  );
}
initDB();

// ========================
// Root
// ========================
app.get("/", (_, res) => res.send("CityFix API Active 🟢"));

// ========================
// Auth → Register User
// ========================
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    if (!user.email) return res.status(400).json({ message: "Email required" });

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) return res.status(409).json({ message: "User exists" });

    const role = user.email === process.env.ADMIN_EMAIL ? "admin" : "citizen";

    const result = await usersCollection.insertOne({
      ...user,
      role,
      status: "active",
      premium: false,
      createdAt: new Date(),
    });

    res.send({ insertedId: result.insertedId });
  } catch {
    res.status(500).json({ message: "User registration error" });
  }
});

// ========================
// Get One User
// ========================
app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({ email: req.params.email });
  res.send(user);
});

// ========================
// Admin → Get All Users
// ========================
app.get("/admin/users", async (_, res) => {
  try {
    const users = await usersCollection
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(users);
  } catch {
    res.status(500).json({ error: "Failed to load users" });
  }
});

// ========================
// Admin → Change Role
// ========================
app.patch("/admin/users/role/:id", async (req, res) => {
  try {
    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role: req.body.role } }
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to update role" });
  }
});

// ========================
// Admin → Block / Unblock User
// ========================
app.patch("/admin/users/status/:id", async (req, res) => {
  try {
    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: req.body.status } }
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to update status" });
  }
});

// ========================
// Admin → Stats Dashboard
// ========================
app.get("/admin/stats", async (_, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalStaff = await usersCollection.countDocuments({ role: "staff" });
    const totalIssues = await issuesCollection.countDocuments();
    const pendingIssues = await issuesCollection.countDocuments({
      status: "pending",
    });
    const inProgressIssues = await issuesCollection.countDocuments({
      status: "in-progress",
    });
    const resolvedIssues = await issuesCollection.countDocuments({
      status: "resolved",
    });

    res.send({
      totalUsers,
      totalStaff,
      totalIssues,
      pendingIssues,
      inProgressIssues,
      resolvedIssues,
    });
  } catch {
    res.status(500).json({ error: "Admin stats failed" });
  }
});

// ========================
// Stripe Checkout (BDT)
// ========================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: req.body.email,
      payment_method_types: ["card"],
      currency: "bdt",
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: "CityFix Premium Subscription 🚀" },
            unit_amount: 1000 * 100,
          },
          quantity: 1,
        },
      ],
      success_url: `http://localhost:5173/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:5173/payment-cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Stripe session failed" });
  }
});

// ========================
// Retrieve Checkout Session
// ========================
app.get("/checkout-session/:id", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json(session);
  } catch {
    res.status(500).json({ error: "Session fetch failed" });
  }
});

// ========================
// Payment Success → Mark Premium
// ========================
app.post("/payment/success", async (req, res) => {
  try {
    const { email, session_id } = req.body;

    await usersCollection.updateOne({ email }, { $set: { premium: true } });

    await paymentsCollection.insertOne({
      email,
      type: "premium",
      method: "stripe",
      session_id,
      amount: 1000,
      currency: "BDT",
      status: "paid",
      date: new Date(),
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Premium update failed" });
  }
});

// ========================
// User Payment History
// ========================
app.get("/payments/user/:email", async (req, res) => {
  try {
    const list = await paymentsCollection
      .find({ email: req.params.email })
      .sort({ date: -1 })
      .toArray();

    res.send(list);
  } catch {
    res.status(500).json({ error: "User payments fetch failed" });
  }
});

// ========================
// Admin → All payments list
// ========================
app.get("/admin/payments", async (_, res) => {
  try {
    const payments = await paymentsCollection
      .find({})
      .sort({ date: -1 })
      .toArray();
    res.send(payments);
  } catch {
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// ========================
// Admin → Payment Summary
// ========================
app.get("/admin/payments/summary", async (_, res) => {
  try {
    const revenue = await paymentsCollection
      .aggregate([
        { $match: { type: "premium", status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray();

    const premiumUsers = await usersCollection.countDocuments({
      premium: true,
    });

    res.send({
      totalRevenue: revenue[0]?.total || 0,
      premiumUsers,
    });
  } catch {
    res.status(500).json({ error: "Payment summary failed" });
  }
});

// ========================
// Staff List
// ========================
app.get("/staff", async (_, res) => {
  const list = await usersCollection.find({ role: "staff" }).toArray();
  res.send(list);
});

// ========================
// Issue Count by User
// ========================
app.get("/issues/count/:email", async (req, res) => {
  const count = await issuesCollection.countDocuments({
    reporterEmail: req.params.email,
  });
  res.send({ count });
});

// ========================
// User Specific Issues
// ========================
app.get("/issues/user/:email", async (req, res) => {
  try {
    const issues = await issuesCollection
      .find({ reporterEmail: req.params.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(issues);
  } catch {
    res.status(500).json({ error: "User issue fetch failed" });
  }
});

// ========================
// Issue List + Filters + Pagination
// ========================
app.get("/issues", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const skip = (page - 1) * limit;

    const q = {};

    if (req.query.category) q.category = req.query.category;
    if (req.query.status) q.status = req.query.status;
    if (req.query.priority) q.priority = req.query.priority;

    if (req.query.search) {
      const s = req.query.search;
      q.$or = [
        { title: { $regex: s, $options: "i" } },
        { location: { $regex: s, $options: "i" } },
        { category: { $regex: s, $options: "i" } },
      ];
    }

    const total = await issuesCollection.countDocuments(q);

    const issues = await issuesCollection
      .find(q)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ total, issues });
  } catch {
    res.status(500).json({ message: "Issue query failed" });
  }
});

// ========================
// Single Issue
// ========================
app.get("/issues/:id", async (req, res) => {
  try {
    const issue = await issuesCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!issue) return res.status(404).json({ message: "Not found" });
    res.send(issue);
  } catch {
    res.status(400).json({ message: "Invalid Issue ID" });
  }
});

// ========================
// Create Issue
// ========================
app.post("/issues", async (req, res) => {
  const d = req.body;
  const reporter = await usersCollection.findOne({ email: d.reporterEmail });

  const issue = {
    title: d.title,
    description: d.description,
    reporterEmail: d.reporterEmail,
    reporterPremium: reporter?.premium || false,
    category: d.category,
    location: d.location,
    image: d.image || "",
    priority: d.priority || "normal",
    status: "pending",
    assignedStaff: null,
    upvotes: [],
    createdAt: new Date(),
    timeline: [
      {
        status: "pending",
        message: "Issue created",
        by: d.reporterEmail,
        time: new Date(),
      },
    ],
  };

  const result = await issuesCollection.insertOne(issue);
  res.send({ insertedId: result.insertedId });
});

// ========================
// Assign Staff
// ========================
app.patch("/issues/assign/:id", async (req, res) => {
  const staff = req.body;

  await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: { assignedStaff: staff },
      $push: {
        timeline: {
          status: "assigned",
          message: `Assigned to ${staff.name}`,
          by: "admin",
          time: new Date(),
        },
      },
    }
  );

  res.send({ success: true });
});

// ========================
// Staff Assigned Issues
// ========================
app.get("/issues/staff/:email", async (req, res) => {
  try {
    const list = await issuesCollection
      .find({ "assignedStaff.email": req.params.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(list);
  } catch {
    res.status(500).json({ error: "Failed to load staff assigned issues" });
  }
});

// ========================
// Staff → Update Issue Status
// ========================
app.patch("/issues/status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status, by } = req.body;

    await issuesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: { status },
        $push: {
          timeline: {
            status,
            message: `Issue marked as ${status}`,
            by,
            time: new Date(),
          },
        },
      }
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Status update failed" });
  }
});

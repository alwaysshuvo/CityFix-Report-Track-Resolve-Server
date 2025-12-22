import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import Stripe from "stripe";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Stripe Init
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// MongoDB Setup
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

  console.log("🔥 MongoDB Connected Successfully");
  app.listen(port, () =>
    console.log(`🚀 API running at http://localhost:${port}`)
  );
}
initDB();

// Root
app.get("/", (_, res) => res.send("CityFix API Active 🟢"));

// Auth — Register User
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    if (!user.email) {
      return res.status(400).json({ message: "Email required" });
    }

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) {
      return res.status(200).json(exists); // safe fallback
    }

    const role = user.email === process.env.ADMIN_EMAIL ? "admin" : "citizen";

    const result = await usersCollection.insertOne({
      ...user,
      role,
      status: "active",
      premium: false,
      createdAt: new Date(),
    });

    res.json({ insertedId: result.insertedId, role });
  } catch (err) {
    res.status(500).json({ message: "User registration error", error: err });
  }
});

// Get One User (safe fallback)
app.get("/users/:email", async (req, res) => {
  try {
    const user = await usersCollection.findOne({ email: req.params.email });
    if (!user) {
      return res.json({
        email: req.params.email,
        role: "citizen",
        premium: false,
        status: "active",
      });
    }
    res.json(user);
  } catch {
    res.status(500).json({ error: "Fetch failed" });
  }
});

// Admin — Get All Users
app.get("/admin/users", async (_, res) => {
  try {
    const users = await usersCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.json(users);
  } catch {
    res.status(500).json({ error: "Failed to load users" });
  }
});

// Admin — Change Role
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

// Admin — Block / Unblock
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

// Admin — Stats
app.get("/admin/stats", async (_, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalStaff = await usersCollection.countDocuments({ role: "staff" });
    const totalCitizens = await usersCollection.countDocuments({ role: "citizen" });

    const totalIssues = await issuesCollection.countDocuments();
    const pendingIssues = await issuesCollection.countDocuments({ status: "pending" });
    const inProgressIssues = await issuesCollection.countDocuments({ status: "in-progress" });
    const resolvedIssues = await issuesCollection.countDocuments({ status: "resolved" });

    res.json({
      totalUsers,
      totalCitizens,
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

// Stripe Checkout
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
  } catch {
    res.status(500).json({ error: "Stripe session failed" });
  }
});

// Payment Success
app.post("/payment/success", async (req, res) => {
  try {
    const { email, session_id } = req.body;

    await usersCollection.updateOne(
      { email },
      { $set: { premium: true } }
    );

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

// User Payment History
app.get("/payments/user/:email", async (req, res) => {
  try {
    const list = await paymentsCollection
      .find({ email: req.params.email })
      .sort({ date: -1 })
      .toArray();

    res.json(list);
  } catch {
    res.status(500).json({ error: "User payments fetch failed" });
  }
});

// Admin Payments
app.get("/admin/payments", async (_, res) => {
  try {
    const payments = await paymentsCollection
      .find({})
      .sort({ date: -1 })
      .toArray();
    res.json(payments);
  } catch {
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// Admin Payment Summary
app.get("/admin/payments/summary", async (_, res) => {
  try {
    const revenue = await paymentsCollection.aggregate([
      { $match: { type: "premium", status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).toArray();

    const premiumUsers = await usersCollection.countDocuments({ premium: true });

    res.json({
      totalRevenue: revenue[0]?.total || 0,
      premiumUsers,
    });
  } catch {
    res.status(500).json({ error: "Payment summary failed" });
  }
});

// Staff List
app.get("/staff", async (_, res) => {
  const list = await usersCollection.find({ role: "staff" }).toArray();
  res.json(list);
});

// Issue Count By User
app.get("/issues/count/:email", async (req, res) => {
  const count = await issuesCollection.countDocuments({
    reporterEmail: req.params.email,
  });
  res.json({ count });
});

// User Issues
app.get("/issues/user/:email", async (req, res) => {
  try {
    const issues = await issuesCollection
      .find({ reporterEmail: req.params.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(issues);
  } catch {
    res.status(500).json({ error: "User issue fetch failed" });
  }
});

// Issues List with Filters
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

    res.json({ total, issues });
  } catch {
    res.status(500).json({ message: "Issue query failed" });
  }
});

// Single Issue
app.get("/issues/:id", async (req, res) => {
  try {
    const issue = await issuesCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!issue) return res.status(404).json({ message: "Not found" });
    res.json(issue);
  } catch {
    res.status(400).json({ message: "Invalid Issue ID" });
  }
});

// Create Issue
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
  res.json({ insertedId: result.insertedId });
});

// Assign Staff
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

  res.json({ success: true });
});

// Staff — Update Issue
app.patch("/issues/status/:id", async (req, res) => {
  try {
    const { status, by } = req.body;

    await issuesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
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

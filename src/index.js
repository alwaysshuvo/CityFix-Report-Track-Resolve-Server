import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import Stripe from "stripe";

dotenv.config();
const app = express();

/* ===========================
        CONFIG
=========================== */
const port = process.env.PORT || 5000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CLIENT = process.env.CLIENT || "http://localhost:5173";

/* ===========================
        MIDDLEWARE
=========================== */
app.use(cors());
app.use(express.json());

/* ===========================
        MONGO INIT
=========================== */
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
    console.log(`🚀 Server Live → http://localhost:${port}`)
  );
}
initDB();

/* ===========================
        ROOT
=========================== */
app.get("/", (_, res) => {
  res.send("CityFix API Active 🟢");
});

/* ===========================
        USER REGISTER
=========================== */
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    if (!user.email) return res.status(400).json({ message: "Email Required" });

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) return res.json(exists);

    const role = user.email === process.env.ADMIN_EMAIL ? "admin" : "citizen";

    const doc = {
      ...user,
      role,
      status: "active",
      premium: false,
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(doc);
    res.json({ insertedId: result.insertedId, role });
  } catch (err) {
    res.status(500).json({ message: "User registration failed" });
  }
});

/* ===========================
        GET USER
=========================== */
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

/* ===========================
  STRIPE CHECKOUT SESSION
=========================== */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await usersCollection.findOne({ email });
    if (user?.premium === true) {
      return res.status(400).json({ error: "User already Premium!" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
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
      success_url: `${CLIENT}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT}/payment-cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Stripe session failed" });
  }
});

/* ===========================
  CHECKOUT SESSION
=========================== */
app.get("/checkout-session/:id", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json(session);
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

/* ===========================
  PAYMENT SUCCESS
=========================== */
app.post("/payment/success", async (req, res) => {
  try {
    const { email, session_id } = req.body;
    if (!email || !session_id)
      return res.status(400).json({ error: "Missing fields" });

    await usersCollection.updateOne({ email }, { $set: { premium: true } });

    await paymentsCollection.updateOne(
      { email },
      {
        $set: {
          type: "premium",
          method: "stripe",
          session_id,
          amount: 1000,
          currency: "BDT",
          status: "paid",
          date: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Premium flag failed" });
  }
});

/* ===========================
  USER PAYMENTS
=========================== */
app.get("/payments/user/:email", async (req, res) => {
  try {
    const list = await paymentsCollection
      .find({ email: req.params.email })
      .sort({ date: -1 })
      .toArray();
    res.json(list);
  } catch {
    res.status(500).json({ error: "Fetch failed" });
  }
});

/* ===========================
  ADMIN PAYMENTS
=========================== */
app.get("/admin/payments", async (_, res) => {
  try {
    const list = await paymentsCollection.find({}).sort({ date: -1 }).toArray();
    res.json(list);
  } catch {
    res.status(500).json({ error: "Failed to load" });
  }
});

/* ===========================
  ADMIN PAYMENT SUMMARY
=========================== */
app.get("/admin/payments/summary", async (_, res) => {
  try {
    const revenue = await paymentsCollection
      .aggregate([
        { $match: { type: "premium", status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray();

    const premiumUsers = await usersCollection.countDocuments({ premium: true });

    res.json({
      totalRevenue: revenue[0]?.total || 0,
      premiumUsers,
    });
  } catch {
    res.status(500).json({ error: "Summary failed" });
  }
});

/* ===========================
   ADMIN USERS
=========================== */
app.get("/admin/users", async (_, res) => {
  try {
    const users = await usersCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.json(users);
  } catch {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.patch("/admin/users/role/:id", async (req, res) => {
  try {
    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role: req.body.role } }
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Role update failed" });
  }
});

app.patch("/admin/users/status/:id", async (req, res) => {
  try {
    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: req.body.status } }
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Status update failed" });
  }
});

/* ===========================
   ADMIN DASHBOARD STATS (FINAL)
=========================== */
app.get("/admin/stats", async (_, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalStaff = await usersCollection.countDocuments({ role: "staff" });

    const totalIssues = await issuesCollection.countDocuments();
    const pendingIssues = await issuesCollection.countDocuments({ status: "pending" });
    const inProgressIssues = await issuesCollection.countDocuments({
      status: { $in: ["in progress", "in-progress"] },
    });
    const resolvedIssues = await issuesCollection.countDocuments({
      status: { $in: ["resolved", "completed"] },
    });

    res.json({
      totalUsers,
      totalStaff,
      totalIssues,
      pendingIssues,
      inProgressIssues,
      resolvedIssues,
    });
  } catch {
    res.status(500).json({ error: "Stats failed" });
  }
});

/* ===========================
   STAFF LIST
=========================== */
app.get("/staff", async (_, res) => {
  const list = await usersCollection.find({ role: "staff" }).toArray();
  res.json(list);
});

/* ===========================
   ISSUE COUNT
=========================== */
app.get("/issues/count/:email", async (req, res) => {
  const total = await issuesCollection.countDocuments({
    reporterEmail: req.params.email,
  });
  res.json({ total });
});

/* ===========================
   USER ISSUES
=========================== */
app.get("/issues/user/:email", async (req, res) => {
  try {
    const list = await issuesCollection
      .find({ reporterEmail: req.params.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(list);
  } catch {
    res.status(500).json({ error: "Fetch failed" });
  }
});

/* ===========================
   ISSUE LIST + FILTER
=========================== */
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
    const list = await issuesCollection
      .find(q)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ total, issues: list });
  } catch {
    res.status(500).json({ message: "Query failed" });
  }
});

/* ===========================
   SINGLE ISSUE
=========================== */
app.get("/issues/:id", async (req, res) => {
  try {
    const doc = await issuesCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json(doc);
  } catch {
    res.status(400).json({ message: "Invalid ID" });
  }
});

/* ===========================
   CREATE ISSUE
=========================== */
app.post("/issues", async (req, res) => {
  try {
    const d = req.body;
    const reporter = await usersCollection.findOne({ email: d.reporterEmail });

    const doc = {
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

    const result = await issuesCollection.insertOne(doc);
    res.json({ insertedId: result.insertedId });
  } catch {
    res.status(500).json({ error: "Create failed" });
  }
});

/* ===========================
   ASSIGN STAFF
=========================== */
app.patch("/issues/assign/:id", async (req, res) => {
  await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: { assignedStaff: req.body },
      $push: {
        timeline: {
          status: "assigned",
          message: `Assigned to ${req.body.name}`,
          by: "admin",
          time: new Date(),
        },
      },
    }
  );
  res.json({ success: true });
});

/* ===========================
   UPDATE ISSUE STATUS
=========================== */
app.patch("/issues/status/:id", async (req, res) => {
  try {
    await issuesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: { status: req.body.status },
        $push: {
          timeline: {
            status: req.body.status,
            message: `Marked as ${req.body.status}`,
            by: req.body.by,
            time: new Date(),
          },
        },
      }
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Status failed" });
  }
});

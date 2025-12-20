import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

/* ======================
   MIDDLEWARE
====================== */
app.use(cors());
app.use(express.json());

/* ======================
   MONGODB CONNECTION
====================== */
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

async function connectDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    usersCollection = db.collection("users");
    issuesCollection = db.collection("issues");
    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
  }
}
connectDB();

/* ======================
   ROOT
====================== */
app.get("/", (req, res) => {
  res.send("🚀 CityFix API is running");
});

/* ======================
   USERS
====================== */

// Save user (Register / Google login)
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) return res.send({ message: "User already exists" });

    const role =
      user.email === process.env.ADMIN_EMAIL ? "admin" : "citizen";

    const result = await usersCollection.insertOne({
      ...user,
      role,
      createdAt: new Date(),
    });

    res.send(result);
  } catch {
    res.status(500).send({ message: "Failed to save user" });
  }
});

// Get user by email (useRole hook)
app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({
    email: req.params.email,
  });
  res.send(user);
});

/* ======================
   ISSUES
====================== */

// Get all issues
app.get("/issues", async (req, res) => {
  const issues = await issuesCollection.find().toArray();
  res.send(issues);
});

// Create issue
app.post("/issues", async (req, res) => {
  const issue = {
    ...req.body,
    status: "pending",
    priority: req.body.priority || "normal",
    createdAt: new Date(),
  };

  const result = await issuesCollection.insertOne(issue);
  res.send(result);
});

// Assign staff (ADMIN)
app.patch("/issues/assign/:id", async (req, res) => {
  const issueId = req.params.id;
  const staff = req.body; // { name, email }

  if (!staff?.email) {
    return res.status(400).send({ message: "Staff info required" });
  }

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(issueId) },
    {
      $set: {
        assignedStaff: staff,
        status: "in-progress",
      },
    }
  );

  res.send({ success: true, result });
});

// Update issue status
app.patch("/issues/status/:id", async (req, res) => {
  const { status } = req.body;

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );

  res.send(result);
});

// Staff assigned issues
app.get("/issues/staff/:email", async (req, res) => {
  const issues = await issuesCollection
    .find({ "assignedStaff.email": req.params.email })
    .toArray();

  res.send(issues);
});

/* ======================
   ADMIN DASHBOARD STATS
====================== */
app.get("/admin/stats", async (req, res) => {
  try {
    const totalIssues = await issuesCollection.countDocuments();
    const pendingIssues = await issuesCollection.countDocuments({ status: "pending" });
    const inProgressIssues = await issuesCollection.countDocuments({ status: "in-progress" });
    const resolvedIssues = await issuesCollection.countDocuments({ status: "resolved" });

    const totalUsers = await usersCollection.countDocuments({ role: "citizen" });
    const totalStaff = await usersCollection.countDocuments({ role: "staff" });

    res.send({
      totalIssues,
      pendingIssues,
      inProgressIssues,
      resolvedIssues,
      totalUsers,
      totalStaff,
    });
  } catch {
    res.status(500).send({ message: "Failed to load admin stats" });
  }
});

/* ======================
   SERVER
====================== */
app.listen(port, () => {
  console.log(`🔥 CityFix server running on port ${port}`);
});

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wemtzez.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let issuesCollection;
let usersCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    issuesCollection = db.collection("issues");
    usersCollection = db.collection("users");

    console.log("✅ MongoDB connected successfully");
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
   USERS API (ROLE SYSTEM)
====================== */

// Save user (Register / Google Login)
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const existingUser = await usersCollection.findOne({ email: user.email });
    if (existingUser) {
      return res.send({ message: "User already exists" });
    }

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

// Get user by email
app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({
    email: req.params.email,
  });
  res.send(user);
});

// Admin check (IMPORTANT)
app.get("/users/admin/:email", async (req, res) => {
  const user = await usersCollection.findOne({
    email: req.params.email,
  });

  res.send({ admin: user?.role === "admin" });
});

/* ======================
   ISSUES API
====================== */

// Get all issues
app.get("/issues", async (req, res) => {
  try {
    const issues = await issuesCollection.find().toArray();
    res.send(issues);
  } catch {
    res.status(500).send({ message: "Failed to fetch issues" });
  }
});

// Get single issue
app.get("/issues/:id", async (req, res) => {
  try {
    const issue = await issuesCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    res.send(issue);
  } catch {
    res.status(500).send({ message: "Failed to fetch issue" });
  }
});

// Create issue
app.post("/issues", async (req, res) => {
  const issue = {
    ...req.body,
    upvotes: 0,
    upvotedBy: [],
    createdAt: new Date(),
  };

  const result = await issuesCollection.insertOne(issue);
  res.send(result);
});

// Update issue status
app.patch("/issues/:id", async (req, res) => {
  const { status } = req.body;

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );

  res.send(result);
});

// Delete issue
app.delete("/issues/:id", async (req, res) => {
  const result = await issuesCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  });
  res.send(result);
});

// Upvote issue
app.patch("/issues/upvote/:id", async (req, res) => {
  const { userId } = req.body;

  const issue = await issuesCollection.findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!issue) {
    return res.status(404).send({ message: "Issue not found" });
  }

  if (issue.authorId === userId) {
    return res.status(403).send({ message: "Cannot upvote own issue" });
  }

  if (issue.upvotedBy.includes(userId)) {
    return res.status(409).send({ message: "Already upvoted" });
  }

  await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $inc: { upvotes: 1 },
      $push: { upvotedBy: userId },
    }
  );

  res.send({ success: true });
});

/* ======================
   SERVER START
====================== */
app.listen(port, () => {
  console.log(`🔥 CityFix server running on port ${port}`);
});

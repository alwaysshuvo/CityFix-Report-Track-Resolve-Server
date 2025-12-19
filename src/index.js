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

let usersCollection;
let issuesCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    usersCollection = db.collection("users");
    issuesCollection = db.collection("issues");

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
   USERS API
====================== */

// Save user (Register / Google Login)
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const existingUser = await usersCollection.findOne({
      email: user.email,
    });

    if (existingUser) {
      return res.send(existingUser);
    }

    const role =
      user.email === process.env.ADMIN_EMAIL
        ? "admin"
        : user.role || "citizen";

    const newUser = {
      ...user,
      role,
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    res.send(result);
  } catch {
    res.status(500).send({ message: "Failed to save user" });
  }
});

// Get user by email (role check)
app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({
    email: req.params.email,
  });
  res.send(user);
});

// Get all staff (ADMIN)
app.get("/staff", async (req, res) => {
  const staffs = await usersCollection
    .find({ role: "staff" })
    .toArray();
  res.send(staffs);
});

// Update staff status (ADMIN)
app.patch("/staff/status/:id", async (req, res) => {
  const { status } = req.body;

  const result = await usersCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );

  res.send(result);
});

/* ======================
   ISSUES API
====================== */

// Create issue (Citizen)
app.post("/issues", async (req, res) => {
  const issue = {
    ...req.body,
    status: "pending",
    priority: req.body.priority || "normal",
    upvotes: 0,
    upvotedBy: [],
    createdAt: new Date(),
  };

  const result = await issuesCollection.insertOne(issue);
  res.send(result);
});

// Get all issues
app.get("/issues", async (req, res) => {
  const issues = await issuesCollection.find().toArray();
  res.send(issues);
});

// Get single issue
app.get("/issues/:id", async (req, res) => {
  const issue = await issuesCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  res.send(issue);
});

// Assign staff to issue (ADMIN)
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

// Get issues assigned to staff
app.get("/issues/staff/:email", async (req, res) => {
  const email = req.params.email;

  const issues = await issuesCollection
    .find({ "assignedStaff.email": email })
    .toArray();

  res.send(issues);
});

// Update issue status (Staff/Admin)
app.patch("/issues/status/:id", async (req, res) => {
  const { status } = req.body;

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );

  res.send(result);
});

// Delete issue (Admin)
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

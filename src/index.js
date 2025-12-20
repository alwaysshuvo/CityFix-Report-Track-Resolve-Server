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
   DATABASE
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
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB error:", error.message);
  }
}
connectDB();

/* ======================
   ROOT
====================== */
app.get("/", (req, res) => {
  res.send("CityFix API running");
});

/* ======================
   USERS
====================== */
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
      status: "active",
      createdAt: new Date(),
    });

    res.send(result);
  } catch {
    res.status(500).send({ message: "User creation failed" });
  }
});

app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({
    email: req.params.email,
  });
  res.send(user);
});

/* ======================
   ADMIN USERS
====================== */
app.get("/admin/users", async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.send(users);
  } catch {
    res.status(500).send({ message: "Failed to load users" });
  }
});

app.patch("/admin/users/role/:id", async (req, res) => {
  const { role } = req.body;

  if (!["citizen", "staff", "admin"].includes(role)) {
    return res.status(400).send({ message: "Invalid role" });
  }

  const result = await usersCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { role } }
  );

  res.send(result);
});

app.patch("/admin/users/status/:id", async (req, res) => {
  const { status } = req.body;

  const result = await usersCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );

  res.send(result);
});

/* ======================
   ISSUES
====================== */
app.get("/issues", async (req, res) => {
  const issues = await issuesCollection.find().toArray();
  res.send(issues);
});

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

app.patch("/issues/assign/:id", async (req, res) => {
  const staff = req.body;

  if (!staff?.email) {
    return res.status(400).send({ message: "Staff info required" });
  }

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: {
        assignedStaff: staff,
        status: "in-progress",
      },
    }
  );

  res.send(result);
});

app.patch("/issues/status/:id", async (req, res) => {
  const { status } = req.body;

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status } }
  );

  res.send(result);
});

app.get("/issues/staff/:email", async (req, res) => {
  const issues = await issuesCollection
    .find({ "assignedStaff.email": req.params.email })
    .toArray();

  res.send(issues);
});

/* ======================
   ADMIN STATS
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
    res.status(500).send({ message: "Stats load failed" });
  }
});

/* ======================
   SERVER
====================== */
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

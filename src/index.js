import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ======================
   MONGODB
====================== */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wemtzez.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection, issuesCollection;

async function connectDB() {
  await client.connect();
  const db = client.db(process.env.DB_NAME);
  usersCollection = db.collection("users");
  issuesCollection = db.collection("issues");
  console.log("✅ MongoDB Connected");
}
connectDB();

/* ======================
   JWT MIDDLEWARE
====================== */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Invalid token" });
    }
    req.decoded = decoded;
    next();
  });
};

const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (user?.role !== "admin") {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

const verifyStaff = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (user?.role !== "staff") {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

/* ======================
   JWT ISSUE
====================== */
app.post("/jwt", async (req, res) => {
  const user = req.body; // { email }
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "7d",
  });
  res.send({ token });
});

/* ======================
   USERS
====================== */
app.post("/users", async (req, res) => {
  const user = req.body;

  const exists = await usersCollection.findOne({ email: user.email });
  if (exists) return res.send({ message: "User exists" });

  const role =
    user.email === process.env.ADMIN_EMAIL
      ? "admin"
      : user.role || "citizen";

  const result = await usersCollection.insertOne({
    ...user,
    role,
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({ email: req.params.email });
  res.send(user);
});

/* ======================
   ADMIN PROTECTED
====================== */
app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
  const users = await usersCollection.countDocuments();
  const issues = await issuesCollection.countDocuments();
  res.send({ users, issues });
});

// ======================
// ADMIN STATS
// ======================
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
  } catch (error) {
    res.status(500).send({ message: "Failed to load admin stats" });
  }
});

/* ======================
   STAFF PROTECTED
====================== */
app.get("/staff/issues", verifyToken, verifyStaff, async (req, res) => {
  const email = req.decoded.email;
  const issues = await issuesCollection
    .find({ "assignedStaff.email": email })
    .toArray();
  res.send(issues);
});

/* ======================
   SERVER
====================== */
app.listen(port, () => {
  console.log(`🔥 CityFix API running on ${port}`);
});

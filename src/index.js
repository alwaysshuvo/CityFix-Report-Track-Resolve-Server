import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;


  //  Middleware

app.use(cors());
app.use(express.json());


  //  MongoDB Connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wemtzez.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let issuesCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    issuesCollection = db.collection("issues");
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
  }
}

connectDB();


app.get("/", (req, res) => {
  res.send("🚀 CityFix API is running");
});



// Get all issues
app.get("/issues", async (req, res) => {
  try {
    const issues = await issuesCollection.find().toArray();
    res.send(issues);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch issues" });
  }
});

// Get single issue by ID
app.get("/issues/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
    res.send(issue);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch issue" });
  }
});

// Create new issue
app.post("/issues", async (req, res) => {
  try {
    const issue = {
      ...req.body,
      createdAt: new Date(),
    };
    const result = await issuesCollection.insertOne(issue);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to create issue" });
  }
});

// Update issue status
app.patch("/issues/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const result = await issuesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update issue" });
  }
});

// Delete issue
app.delete("/issues/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await issuesCollection.deleteOne({
      _id: new ObjectId(id),
    });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete issue" });
  }
});

// Upvote an issue
app.patch("/issues/upvote/:id", async (req, res) => {
  try {
    const issueId = req.params.id;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).send({ message: "User ID required" });
    }

    const issue = await issuesCollection.findOne({
      _id: new ObjectId(issueId),
    });

    if (!issue) {
      return res.status(404).send({ message: "Issue not found" });
    }

    if (issue.authorId === userId) {
      return res
        .status(403)
        .send({ message: "You cannot upvote your own issue" });
    }

    if (issue.upvotedBy?.includes(userId)) {
      return res
        .status(409)
        .send({ message: "You already upvoted this issue" });
    }

    const result = await issuesCollection.updateOne(
      { _id: new ObjectId(issueId) },
      {
        $inc: { upvotes: 1 },
        $push: { upvotedBy: userId },
      }
    );

    res.send({
      success: true,
      message: "Upvote added successfully",
      result,
    });
  } catch (error) {
    res.status(500).send({ message: "Upvote failed" });
  }
});


  //  Server Start

app.listen(port, () => {
  console.log(`🔥 CityFix server running on port ${port}`);
});

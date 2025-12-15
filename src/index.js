import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());


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
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
}
connectDB();

app.get("/", (req, res) => {
  res.send("CityFix API is running 🚀");
});


app.get("/issues", async (req, res) => {
  const result = await issuesCollection.find().toArray();
  res.send(result);
});


app.get("/issues/:id", async (req, res) => {
  const id = req.params.id;
  const result = await issuesCollection.findOne({ _id: new ObjectId(id) });
  res.send(result);
});


app.post("/issues", async (req, res) => {
  const issue = req.body;
  issue.createdAt = new Date();
  const result = await issuesCollection.insertOne(issue);
  res.send(result);
});


app.patch("/issues/:id", async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const result = await issuesCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );

  res.send(result);
});


app.delete("/issues/:id", async (req, res) => {
  const id = req.params.id;
  const result = await issuesCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});


app.listen(port, () => {
  console.log(`CityFix server running on port ${port}`);
});

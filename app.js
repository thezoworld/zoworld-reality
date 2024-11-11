const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
require("dotenv").config();
const multer = require("multer");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversations (In production, use a proper database)
const conversations = new Map();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Ensure uploads directory exists
const uploadsDir = "./uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Single message endpoint
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res
      .status(400)
      .json({ error: "Message content is required and must be a string." });
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
    });
    res.json({
      message: response.choices[0].message.content,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

// Threaded message endpoint
app.post("/api/thread/:threadId/message", async (req, res) => {
  const { threadId } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    return res
      .status(400)
      .json({ error: "Message content is required and must be a string." });
  }

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const conversation = conversations.get(threadId);
  conversation.push({ role: "user", content: message });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: conversation,
    });

    const aiMessage = response.choices[0].message;
    conversation.push(aiMessage);

    res.json({
      message: aiMessage.content,
      threadId,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

// Thread conversation endpoints
app.post("/api/thread/create", (req, res) => {
  const threadId = Date.now().toString();
  conversations.set(threadId, []);
  res.json({ threadId });
});

app.get("/api/thread/:threadId", (req, res) => {
  const { threadId } = req.params;

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  res.json({
    messages: conversations.get(threadId),
  });
});

// Add the transcription endpoint
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
      language: "en",
    });

    console.log(transcription.text);

    // Clean up: delete the uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("Error deleting file:", err);
    });

    res.json({ transcription: transcription.text });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to transcribe audio" });
  }
});

// Add this route handler for thread search - place it before any other /threads routes
// to avoid conflicts with other thread routes
app.get("/api/threads", (req, res) => {
  try {
    const { search } = req.query;

    let threadList = Array.from(conversations.entries()).map(
      ([id, messages]) => ({
        id,
        preview: messages[0]?.content || "Empty thread",
        timestamp: parseInt(id), // Since we're using Date.now() as threadId
      })
    );

    if (search) {
      threadList = threadList.filter((thread) =>
        thread.preview.toLowerCase().includes(search.toLowerCase())
      );
    }

    threadList.sort((a, b) => b.timestamp - a.timestamp);
    res.json(threadList);
  } catch (error) {
    console.error("Error handling thread search:", error);
    res.status(500).json({ error: "Failed to search threads" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

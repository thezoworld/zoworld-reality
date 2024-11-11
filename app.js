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

// Ensure directories exist
const uploadsDir = "./uploads";
const dataDir = "./data";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Thread persistence functions
function saveThreadsToStorage() {
  const threadsData = {};
  conversations.forEach((threadData, threadId) => {
    threadsData[threadId] = {
      id: threadId,
      messages: threadData.messages,
      title: threadData.title,
      timestamp: threadData.timestamp,
    };
  });

  try {
    fs.writeFileSync("./data/threads.json", JSON.stringify(threadsData));
  } catch (error) {
    console.error("Error saving threads:", error);
  }
}

function loadThreadsFromStorage() {
  try {
    if (fs.existsSync("./data/threads.json")) {
      const threadsData = JSON.parse(fs.readFileSync("./data/threads.json"));
      Object.entries(threadsData).forEach(([threadId, threadData]) => {
        conversations.set(threadId, {
          messages: threadData.messages,
          title: threadData.title,
          timestamp: threadData.timestamp,
        });
      });
    }
  } catch (error) {
    console.error("Error loading threads:", error);
  }
}

// Load threads when server starts
loadThreadsFromStorage();

// Thread API endpoints
app.post("/api/thread/create", (req, res) => {
  const threadId = Date.now().toString();
  const title = "New Thread";

  conversations.set(threadId, {
    messages: [],
    title,
    timestamp: Date.now(),
    messageCount: 0,
  });

  saveThreadsToStorage();
  res.json({ threadId, title });
});

app.get("/api/thread/:threadId", (req, res) => {
  const { threadId } = req.params;

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const threadData = conversations.get(threadId);
  res.json({
    id: threadId,
    ...threadData,
  });
});

app.put("/api/thread/:threadId/rename", (req, res) => {
  const { threadId } = req.params;
  const { title } = req.body;

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  if (!title || typeof title !== "string") {
    return res
      .status(400)
      .json({ error: "Title is required and must be a string" });
  }

  const threadData = conversations.get(threadId);
  threadData.title = title;
  saveThreadsToStorage();

  res.json({ success: true, threadId, title });
});

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

  const threadData = conversations.get(threadId);
  if (!Array.isArray(threadData.messages)) {
    threadData.messages = [];
  }

  const newMessage = { role: "user", content: message, timestamp: Date.now() };
  threadData.messages.push(newMessage);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: threadData.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    const aiMessage = {
      role: "assistant",
      content: response.choices[0].message.content,
      timestamp: Date.now(),
    };
    threadData.messages.push(aiMessage);
    threadData.timestamp = Date.now();

    saveThreadsToStorage();

    res.json({
      message: aiMessage.content,
      threadId,
      messageCount: threadData.messages.length,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

app.get("/api/threads", (req, res) => {
  const threadsList = Array.from(conversations.entries()).map(([id, data]) => {
    const msgCount = Array.isArray(data.messages) ? data.messages.length : 0;

    return {
      id,
      title: data.title,
      preview:
        data.messages?.[data.messages.length - 1]?.content || "New Thread",
      timestamp: data.timestamp,
      msgs: msgCount,
    };
  });

  res.json(threadsList.sort((a, b) => b.timestamp - a.timestamp));
});

// Transcription endpoint
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

// Add this endpoint with the other thread endpoints
app.delete("/api/thread/:threadId", (req, res) => {
  const { threadId } = req.params;

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  conversations.delete(threadId);
  saveThreadsToStorage();

  res.json({ success: true, threadId });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversations (In production, use a proper database)
const conversations = new Map();
const iamaiConversations = new Map();

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

// Thread persistence functions
function saveIAMAIThreadsToStorage() {
  const threadsData = {};
  iamaiConversations.forEach((threadData, threadId) => {
    threadsData[threadId] = {
      id: threadId,
      messages: threadData.messages,
      title: threadData.title,
      timestamp: threadData.timestamp,
    };
  });

  try {
    fs.writeFileSync("./data/iamai-threads.json", JSON.stringify(threadsData));
  } catch (error) {
    console.error("Error saving IAMAI threads:", error);
  }
}

function loadIAMAIThreadsFromStorage() {
  try {
    if (fs.existsSync("./data/iamai-threads.json")) {
      const threadsData = JSON.parse(
        fs.readFileSync("./data/iamai-threads.json")
      );
      Object.entries(threadsData).forEach(([threadId, threadData]) => {
        iamaiConversations.set(threadId, {
          messages: threadData.messages,
          title: threadData.title,
          timestamp: threadData.timestamp,
        });
      });
    }
  } catch (error) {
    console.error("Error loading IAMAI threads:", error);
  }
}

// Load threads when server starts
loadThreadsFromStorage();
loadIAMAIThreadsFromStorage();

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

// IAMAI Thread API endpoints
app.post("/api/iamai-thread/create", (req, res) => {
  const threadId = Date.now().toString();
  const title = "New Thread";

  iamaiConversations.set(threadId, {
    messages: [],
    title,
    timestamp: Date.now(),
    messageCount: 0,
  });

  saveIAMAIThreadsToStorage();
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

app.get("/api/iamai-thread/:threadId", (req, res) => {
  const { threadId } = req.params;

  if (!iamaiConversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const threadData = iamaiConversations.get(threadId);
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

app.put("/api/iamai-thread/:threadId/rename", (req, res) => {
  const { threadId } = req.params;
  const { title } = req.body;

  if (!iamaiConversations.has(threadId)) {
    return res.status(404).json({ error: "IAMAI Thread not found" });
  }

  if (!title || typeof title !== "string") {
    return res
      .status(400)
      .json({ error: "Title is required and must be a string" });
  }

  const threadData = iamaiConversations.get(threadId);
  threadData.title = title;
  saveIAMAIThreadsToStorage();

  res.json({ success: true, threadId, title });
});

app.post("/api/thread/:threadId/message", async (req, res) => {
  const { threadId } = req.params;
  const { message, model, fileContent } = req.body;

  if (!message && !fileContent) {
    return res
      .status(400)
      .json({ error: "Message or file content is required." });
  }

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const threadData = conversations.get(threadId);

  if (!Array.isArray(threadData.messages)) {
    threadData.messages = [];
  }

  let openAIMessages = [];

  // If no messages yet, add system content from markdown files
  if (threadData.messages.length === 0) {
    const promptPrefix = readMDFiles();
    openAIMessages.push({
      role: "system",
      content: promptPrefix,
    });
  } else {
    // Include all previous messages
    threadData.messages.forEach((msg) => {
      openAIMessages.push({
        role: msg.role,
        content: msg.content,
      });
    });
  }

  // Add the new user message
  let userMessageContent = message || "What's in this image?";
  if (fileContent && fileContent.image_url && fileContent.image_url.url) {
    // Just append the image URL in text form
    userMessageContent += `\nImage URL: ${fileContent.image_url.url}`;
  }

  openAIMessages.push({
    role: "user",
    content: userMessageContent,
  });

  try {
    const response = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages: openAIMessages,
    });

    const aiMessage = {
      role: "assistant",
      content: response.choices[0].message.content,
      timestamp: Date.now(),
      model: model,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    };

    // Store the user message and AI response
    threadData.messages.push(
      {
        role: "user",
        content: message,
        timestamp: Date.now(),
        fileContent: fileContent ? { type: "image", data: fileContent } : null,
      },
      aiMessage
    );

    threadData.timestamp = Date.now();
    saveThreadsToStorage();

    res.json({
      message: aiMessage.content,
      threadId,
      messageCount: threadData.messages.length,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

app.post("/api/iamai-thread/:threadId/message", async (req, res) => {
  const { threadId } = req.params;
  const { message, model, fileContent } = req.body;

  if (!message && !fileContent) {
    return res
      .status(400)
      .json({ error: "Message or file content is required." });
  }

  if (!iamaiConversations.has(threadId)) {
    return res.status(404).json({ error: "IAMAI Thread not found" });
  }

  const threadData = iamaiConversations.get(threadId);

  if (!Array.isArray(threadData.messages)) {
    threadData.messages = [];
  }

  let openAIMessages = [];

  // If no messages yet, add IAMAI system content
  if (threadData.messages.length === 0) {
    const promptPrefix = readIAMAI();
    openAIMessages.push({
      role: "system",
      content: promptPrefix,
    });
  } else {
    // Include all previous messages
    threadData.messages.forEach((msg) => {
      openAIMessages.push({
        role: msg.role,
        content: msg.content,
      });
    });
  }

  // Add the new user message
  let userMessageContent = message || "What's in this image?";
  if (fileContent && fileContent.image_url && fileContent.image_url.url) {
    userMessageContent += `\nImage URL: ${fileContent.image_url.url}`;
  }

  openAIMessages.push({
    role: "user",
    content: userMessageContent,
  });

  try {
    const response = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages: openAIMessages,
    });

    const aiMessage = {
      role: "assistant",
      content: response.choices[0].message.content,
      timestamp: Date.now(),
      model: model,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    };

    // Store the user message and AI response
    threadData.messages.push(
      {
        role: "user",
        content: message,
        timestamp: Date.now(),
        fileContent: fileContent ? { type: "image", data: fileContent } : null,
      },
      aiMessage
    );

    threadData.timestamp = Date.now();
    saveIAMAIThreadsToStorage();

    res.json({
      message: aiMessage.content,
      threadId,
      messageCount: threadData.messages.length,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
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

app.get("/api/iamai-threads", (req, res) => {
  const threadsList = Array.from(iamaiConversations.entries()).map(
    ([id, data]) => {
      const msgCount = Array.isArray(data.messages) ? data.messages.length : 0;

      return {
        id,
        title: data.title,
        preview:
          data.messages?.[data.messages.length - 1]?.content || "New Thread",
        timestamp: data.timestamp,
        msgs: msgCount,
      };
    }
  );

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

app.delete("/api/iamai-thread/:threadId", (req, res) => {
  const { threadId } = req.params;

  if (!iamaiConversations.has(threadId)) {
    return res.status(404).json({ error: "IAMAI Thread not found" });
  }

  iamaiConversations.delete(threadId);
  saveIAMAIThreadsToStorage();

  res.json({ success: true, threadId });
});

// Add this function to read the markdown file
function readMDFiles() {
  try {
    const philosophyContent = fs.readFileSync(
      "zoworld-reality-philosophy.md",
      "utf8"
    );
    const operationalContent = fs.readFileSync(
      "zoworld-reality-operational.md",
      "utf8"
    );
    const demandContent = fs.readFileSync("zoworld-reality-demand.md", "utf8");
    return (
      philosophyContent + "\n\n" + operationalContent + "\n\n" + demandContent
    );
  } catch (error) {
    console.error("Error reading MD file:", error);
    return ""; // Return empty string if file can't be read
  }
}

function readIAMAI() {
  try {
    const iamaiContent = fs.readFileSync(
      "iamai-agent-character-card.md",
      "utf8"
    );
    return iamaiContent;
  } catch (error) {
    console.error("Error reading MD file:", error);
    return "";
  }
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

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
  const { message, model, fileContent } = req.body;

  if (!message && !fileContent) {
    return res
      .status(400)
      .json({ error: "Message or file content is required." });
  }

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  var promptPrefix = "";
  const threadData = conversations.get(threadId);

  if (!Array.isArray(threadData.messages)) {
    threadData.messages = [];
  }

  if (threadData.messages.length == 0) {
    promptPrefix = readMDFiles();
    promptPrefix += `\n\n`;
  }

  try {
    let messages;
    if (fileContent) {
      // Handle image files
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${promptPrefix}${message || "What's in this image?"}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `${fileContent.image_url.url}`,
              },
            },
          ],
        },
      ];
    } else {
      // Handle regular text messages
      messages = [
        {
          role: "user",
          content: `${promptPrefix}${message}`,
        },
      ];
    }

    const response = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages: messages,
    });

    const aiMessage = {
      role: "assistant",
      content: response.choices[0].message.content,
      timestamp: Date.now(),
      model: model,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    };

    // Store the original message without the prompt prefix
    threadData.messages.push(
      {
        role: "user",
        content: message,
        timestamp: Date.now(),
        fileContent: fileContent
          ? {
              type: "image",
              data: fileContent,
            }
          : null,
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
    return philosophyContent + "\n\n" + operationalContent;
  } catch (error) {
    console.error("Error reading MD file:", error);
    return ""; // Return empty string if file can't be read
  }
}

// Get the prefix content once when server starts
const promptPrefix = readMDFiles();

// Modify your existing chat completion function
app.post("/api/chat", async (req, res) => {
  try {
    const { prompt } = req.body;

    // Prefix the prefix content to the user's prompt
    const fullPrompt = `${promptPrefix}\n\n${prompt}`;

    const completion = await openai.chat.completions.create({
      messages: [{ role: "user", content: fullPrompt }],
      model: "gpt-3.5-turbo",
    });

    res.json({ completion: completion.choices[0].message.content });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get response" });
  }
});

// If you have other OpenAI API calls, modify them similarly
// For example, if you have a completion endpoint:
app.post("/api/completion", async (req, res) => {
  try {
    const { prompt } = req.body;

    // Prefix the prefix content
    const fullPrompt = `${promptPrefix}\n\n${prompt}`;

    const completion = await openai.completions.create({
      prompt: fullPrompt,
      model: "text-davinci-003",
    });

    res.json({ completion: completion.choices[0].text });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get completion" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

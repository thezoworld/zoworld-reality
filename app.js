const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Multer configuration using memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit as per OpenAI docs
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversations
const conversations = new Map();

// Thread conversation with optional file
app.post(
  "/api/thread/:threadId/message",
  upload.single("file"),
  async (req, res) => {
    try {
      const { threadId } = req.params;
      const { message } = req.body;

      if (!conversations.has(threadId)) {
        return res.status(404).json({ error: "Thread not found" });
      }

      const conversation = conversations.get(threadId);
      let userMessage = {
        role: "user",
        content: message ? [{ type: "text", text: message }] : [],
      };

      // If there's a file, add it to the content array
      if (req.file) {
        if (req.file.mimetype.startsWith("image/")) {
          const base64Image = req.file.buffer.toString("base64");
          userMessage.content.push({
            type: "image_url",
            image_url: {
              url: `data:${req.file.mimetype};base64,${base64Image}`,
              detail: "auto", // Can be 'low', 'high', or 'auto'
            },
          });

          // If no message was provided with the image, add a default question
          if (!message) {
            userMessage.content.unshift({
              type: "text",
              text: "What is in this image?",
            });
          }
        }
      }

      conversation.push(userMessage);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conversation,
        max_tokens: 300,
      });

      const aiMessage = {
        role: "assistant",
        content: response.choices[0].message.content,
      };

      conversation.push(aiMessage);

      res.json({
        message: aiMessage.content,
        threadId,
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Failed to get AI response" });
    }
  }
);

// Create new thread
app.post("/api/thread/create", (req, res) => {
  const threadId = Date.now().toString();
  conversations.set(threadId, []);
  res.json({ threadId });
});

// Get thread history
app.get("/api/thread/:threadId", (req, res) => {
  const { threadId } = req.params;

  if (!conversations.has(threadId)) {
    return res.status(404).json({ error: "Thread not found" });
  }

  res.json({
    messages: conversations.get(threadId),
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

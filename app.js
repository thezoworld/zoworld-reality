const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
require("dotenv").config();

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

// Single message endpoint
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message content is required and must be a string." });
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
    return res.status(400).json({ error: "Message content is required and must be a string." });
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
fetch("http://localhost:3001/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message: "Your message here",
  }),
})
  .then((response) => response.json())
  .then((data) => console.log(data))
  .catch((error) => console.error("Error:", error));

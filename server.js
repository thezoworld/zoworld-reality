const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const THREADS_FILE = path.join(__dirname, "threads.json");

// File operations
async function loadThreads() {
  try {
    const data = await fs.readFile(THREADS_FILE, "utf8");
    return JSON.parse(data).threads;
  } catch (error) {
    await fs.writeFile(THREADS_FILE, JSON.stringify({ threads: {} }));
    return {};
  }
}

async function saveThreads(threads) {
  await fs.writeFile(THREADS_FILE, JSON.stringify({ threads }, null, 2));
}

app.post("/chat", async (req, res) => {
  try {
    const { message, threadId } = req.body;
    const threads = await loadThreads();

    // Get or create thread
    if (!threads[threadId]) {
      threads[threadId] = {
        messages: [],
        title: "New Chat",
        created: Date.now(),
        updated: Date.now(),
      };
    }

    // Add user message
    threads[threadId].messages.push({
      role: "user",
      content: message,
      timestamp: Date.now(),
    });

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: threads[threadId].messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: 1000,
      temperature: 0.7,
    });

    const aiMessage = {
      role: response.choices[0]?.message.role,
      content: response.choices[0]?.message.content,
      timestamp: Date.now(),
    };

    threads[threadId].messages.push(aiMessage);
    threads[threadId].updated = Date.now();

    // Update thread title if it's the first message
    if (threads[threadId].messages.length === 2) {
      threads[threadId].title = message.substring(0, 30) + "...";
    }

    await saveThreads(threads);

    res.json({
      response: aiMessage.content,
      threadId: threadId,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: error.message || "An error occurred while processing your request",
    });
  }
});

// Get all threads
app.get("/threads", async (req, res) => {
  try {
    const threads = await loadThreads();
    const { search } = req.query;

    let threadList = Object.entries(threads).map(([id, thread]) => ({
      id,
      title: thread.title,
      preview: thread.messages[0]?.content.substring(0, 50) + "...",
      timestamp: thread.updated,
    }));

    if (search) {
      threadList = threadList.filter((thread) =>
        thread.title.toLowerCase().includes(search.toLowerCase())
      );
    }

    threadList.sort((a, b) => b.timestamp - a.timestamp);
    res.json(threadList);
  } catch (error) {
    res.status(500).json({ error: "Failed to load threads" });
  }
});

// Get specific thread
app.get("/threads/:threadId", async (req, res) => {
  try {
    const threads = await loadThreads();
    const thread = threads[req.params.threadId];
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }
    res.json(thread);
  } catch (error) {
    res.status(500).json({ error: "Failed to load thread" });
  }
});

// Rename thread
app.put("/threads/:threadId/rename", async (req, res) => {
  try {
    const { title } = req.body;
    const threads = await loadThreads();

    if (!threads[req.params.threadId]) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    threads[req.params.threadId].title = title;
    await saveThreads(threads);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to rename thread" });
  }
});

// Delete thread
app.delete("/threads/:threadId", async (req, res) => {
  try {
    const threads = await loadThreads();

    if (!threads[req.params.threadId]) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    delete threads[req.params.threadId];
    await saveThreads(threads);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

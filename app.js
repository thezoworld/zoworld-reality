const { Configuration, OpenAIApi } = require("openai");

require('dotenv').config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function getOpenAIResponse() {
  try {
    const response = await openai.createChatCompletion({
      model: "4o-mini",
      messages: [{ role: "user", content: "Hello, how are you?" }],
    });
    console.log(response.data.choices[0].message.content);
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
  }
}

getOpenAIResponse();

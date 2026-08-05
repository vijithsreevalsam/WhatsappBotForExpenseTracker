import { GoogleGenAI, Type } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const OWNER_1_ID = process.env.OWNER_1_ID || '111111111111';
const OWNER_1_PHONE = process.env.OWNER_1_PHONE || '1111111111';
const OWNER_1_NAME = process.env.OWNER_1_NAME || 'Owner1';

const OWNER_2_ID = process.env.OWNER_2_ID || '222222222222';
const OWNER_2_PHONE = process.env.OWNER_2_PHONE || '2222222222';
const OWNER_2_NAME = process.env.OWNER_2_NAME || 'Owner2';

const ALLOWED_CATEGORIES = [
  "Auto",
  "Entertainment",
  "maid",
  "Food",
  "Home",
  "Medical",
  "Personal",
  "Travel",
  "Utilities",
  "Isha related",
  `${OWNER_1_NAME} personal Expnenses`,
  `${OWNER_2_NAME} Personal expenses`,
  "Shared Personal expenses",
  "Groceries",
  "Gift",
  "Other"
];

async function generateContentWithRetry(generateFn, maxRetries = 3) {
  const models = [
    process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite'
  ];

  let delay = 2000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const modelToUse = models[Math.min(attempt - 1, models.length - 1)];
    try {
      return await generateFn(modelToUse);
    } catch (error) {
      const isRateLimit = error.status === 429 || error.message?.includes("quota") || error.message?.includes("429");
      const isServerErr = error.status === 503 || error.status >= 500 || error.message?.includes("503") || error.message?.includes("500");
      const isModelUnavailable = error.status === 404 || error.message?.includes("not found") || error.message?.includes("no longer available");
      
      if ((isRateLimit || isServerErr || isModelUnavailable) && attempt < maxRetries) {
        const nextModel = models[Math.min(attempt, models.length - 1)];
        console.warn(`⚠️ Model "${modelToUse}" failed (${error.status || 'unknown'}: ${error.message?.slice(0, 100).replace(/\n/g, ' ')}). Falling back to "${nextModel}" in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5;
      } else {
        throw error;
      }
    }
  }
}

/**
 * Helper to replace raw WhatsApp JID/LID mentions (e.g. @+11111111111, @111111111111) with clean names
 */
function replaceMentionsWithNames(text) {
  if (!text) return '';
  return text.replace(/@\+?[0-9\s\-]+/g, (match) => {
    const cleanedDigits = match.replace(/[^0-9]/g, '');
    if (cleanedDigits.includes(OWNER_1_ID) || cleanedDigits.includes(OWNER_1_PHONE)) {
      return `@${OWNER_1_NAME}`;
    }
    if (cleanedDigits.includes(OWNER_2_ID) || cleanedDigits.includes(OWNER_2_PHONE)) {
      return `@${OWNER_2_NAME}`;
    }
    return match;
  });
}

/**
 * Process text message using Gemini AI to detect expense and extract details.
 */
export async function processTextWithAI(messageText, senderName) {
  if (!ai) {
    console.warn("⚠️ GEMINI_API_KEY is not set in .env! Skipping AI analysis.");
    return null;
  }

  // Pre-process messageText to replace raw WhatsApp JID/LID mentions with clean names
  const cleanMessageText = replaceMentionsWithNames(messageText);

  const prompt = `Analyze this message from a family WhatsApp group.
Current Date: ${new Date().toISOString().split('T')[0]}
Sender Name: ${senderName}
Message: "${cleanMessageText}"

Determine if this message is a request/command to switch, use, or create a new spreadsheet sheet/tab (e.g., "Hey bot, from today add entries to new sheet as aug 26", "switch to sheet sep 26", "use tab groceries", "change sheet name to sep 26").
If it is a sheet-switching command:
- Set isCommand to true
- Extract sheetName (the exact requested name for the sheet/tab, e.g., "aug 26" or "groceries").

Otherwise, determine if this message is a request to correct, edit, change, or update a previously logged expense (e.g., "Actually that last expense of 100 was paid by ${OWNER_2_NAME}", "Change last maid expense amount to 90", "Actually the coffee was 15 aed not 25", "The last groceries was actually utilities", "Change row 15 paid by ${OWNER_2_NAME}", "Row 8 amount is 120").
If it is a correction:
- Set isCorrection to true
- Extract targetRowNumber (the numeric row number if the user specifies a specific row number, e.g., "row 15" -> 15, "row 8" -> 8, "for row 5" -> 5. Leave null or omit if they do not mention a row number).
- Extract correctionTarget (keywords/description to identify which entry to correct, e.g. "last", "coffee", "maid", "groceries").
- Extract correctionUpdates (an object with any values to update: paidBy, amount, category, description). "paidBy" should map to ${OWNER_1_NAME} or ${OWNER_2_NAME} based on context (e.g., "paid by ${OWNER_2_NAME}" -> ${OWNER_2_NAME}). Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}.

Otherwise, determine if this message is asking a question or querying about past expenses or sheet statistics (e.g., "what is the total expenses this month?", "how much did ${OWNER_2_NAME} spend on food?", "what did we spend on groceries?", "show me a breakdown", "total for August").
If it is an analytical question:
- Set isQuery to true

Otherwise, determine if this message is logging a financial expense or purchase.
If yes, extract:
- amount (numeric value)
- category (Must be one of: ${ALLOWED_CATEGORIES.join(', ')})
- description (brief purchase summary)
- isExpense (true/false)

If it is just general chat (or not a command/correction/query/expense), return isCommand: false, isCorrection: false, isQuery: false, and isExpense: false.`;

  try {
    const response = await generateContentWithRetry((modelToUse) =>
      ai.models.generateContent({
        model: modelToUse,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isCommand: { type: Type.BOOLEAN, description: "True if message is a command to switch or create a sheet tab" },
              sheetName: { type: Type.STRING, description: "The exact name of the sheet tab to switch to or create" },
              isCorrection: { type: Type.BOOLEAN, description: "True if message is a request to edit/correct a previous expense" },
              targetRowNumber: { type: Type.INTEGER, description: "The specific sheet row number to correct if mentioned (e.g., 'row 15' -> 15)" },
              correctionTarget: { type: Type.STRING, description: "Keywords to find the target expense to update, e.g. 'last', 'coffee', 'maid'" },
              correctionUpdates: {
                type: Type.OBJECT,
                properties: {
                  paidBy: { type: Type.STRING, description: `New name of the person who paid (${OWNER_1_NAME} or ${OWNER_2_NAME})` },
                  amount: { type: Type.NUMBER, description: "New amount value" },
                  category: { type: Type.STRING, description: "New category" },
                  description: { type: Type.STRING, description: "New description" }
                }
              },
              isQuery: { type: Type.BOOLEAN, description: "True if message is asking a question/query about expenses or sheet statistics" },
              isExpense: { type: Type.BOOLEAN, description: "True if message logs a spent amount/expense" },
              amount: { type: Type.NUMBER, description: "Total numeric amount spent" },
              category: { 
                type: Type.STRING, 
                description: "Spending category"
              },
              description: { type: Type.STRING, description: "Brief description of item or purchase" },
            },
            required: ["isCommand", "isCorrection", "isQuery", "isExpense", "correctionUpdates"],
          },
        },
      })
    );

    return JSON.parse(response.text);
  } catch (error) {
    console.error("❌ Gemini Text Processing Error:", error);
    return null;
  }
}

/**
 * Process receipt image using Gemini Vision AI.
 */
export async function processReceiptImageWithAI(imageBuffer, captionText = "", senderName = "") {
  if (!ai) {
    console.warn("⚠️ GEMINI_API_KEY is not set in .env! Skipping AI receipt analysis.");
    return null;
  }

  const prompt = `Analyze this photo of a receipt or invoice sent in a family WhatsApp group.
Current Date: ${new Date().toISOString().split('T')[0]}
Sender Name: ${senderName}
Optional Caption: "${captionText}"

Extract:
1. Total amount spent (numeric).
2. Category (Must be one of: ${ALLOWED_CATEGORIES.join(', ')}).
3. Merchant name and brief list of main items purchased as description.
4. Set isExpense to true if a valid receipt/invoice with total amount is detected.`;

  try {
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType: "image/jpeg",
      },
    };

    const response = await generateContentWithRetry((modelToUse) =>
      ai.models.generateContent({
        model: modelToUse,
        contents: [imagePart, prompt],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isExpense: { type: Type.BOOLEAN, description: "True if image contains a readable receipt or total expense" },
              amount: { type: Type.NUMBER, description: "Total numeric amount spent on receipt" },
              category: { 
                type: Type.STRING, 
                description: "Category of purchase",
                enum: ALLOWED_CATEGORIES
              },
              description: { type: Type.STRING, description: "Store name / item summary" },
            },
            required: ["isExpense"],
          },
        },
      })
    );

    return JSON.parse(response.text);
  } catch (error) {
    console.error("❌ Gemini Image Receipt Processing Error:", error);
    return null;
  }
}

/**
 * Answer an analytical question about the spreadsheet data using Gemini AI.
 */
export async function answerQueryWithSheetData(queryText, sheetName, sheetData) {
  if (!ai) {
    return "⚠️ GEMINI_API_KEY is not configured.";
  }

  const dataStr = JSON.stringify(sheetData, null, 2);
  const prompt = `You are a helpful financial assistant analyzing a couple's expense sheet named "${sheetName}".
Below is the raw list of logged expenses in this sheet tab:
${dataStr}

User Query: "${queryText}"

Calculate the requested totals, category breakdown, or person-specific spending.
Please format your response in a very friendly, clear, and readable layout using markdown:
- Break down the mathematical calculations (list the items you are adding up so the user can verify them).
- Make sure to clearly state which sheet tab was analyzed.
- Use currency format (e.g. AED 123.45).
- If the user query is generic or needs a summary, provide a quick overview.`;

  try {
    const response = await generateContentWithRetry((modelToUse) =>
      ai.models.generateContent({
        model: modelToUse,
        contents: prompt,
      })
    );
    return response.text;
  } catch (error) {
    console.error("❌ Gemini Sheet Analysis Error:", error);
    return "Sorry, I encountered an error while analyzing the sheet data.";
  }
}

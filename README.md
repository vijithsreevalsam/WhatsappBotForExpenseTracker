# WhatsApp Expense Tracker Bot 📊🤖

An intelligent, AI-powered WhatsApp bot that helps couples or teams track their shared expenses directly in a WhatsApp group chat. Built using **Node.js**, **Baileys (WhatsApp Web API)**, **Gemini AI (Google Gen AI SDK)**, and **Google Sheets API**.

Simply send a text (e.g., *"Grocery 120 AED paid by Alex"*) or upload a picture of a receipt, and the bot will automatically categorize it, parse the amount, and log it to your Google Sheet!

---

## 🌟 Key Features

*   **💬 Natural Language Parsing**: Uses Gemini AI to understand casual text expense messages (e.g., *"Coffee 15"* or *"Sam paid 200 for electricity"*).
*   **📷 Receipt Reader (OCR)**: Upload a receipt image, and Gemini Vision AI will automatically read the total amount, merchant name, and item description.
*   **✏️ Live Corrections**: Correct recent logs on the fly (e.g., *"Actually that coffee was 25 not 15"* or *"Row 10 amount was 150"*).
*   **📝 Dynamic Sheet Tabs**: Switch worksheets or create new ones dynamically via chat (e.g., *"Hey bot, switch to September 2026"*).
*   **🔍 Interactive Query & Analysis**: Ask analytical questions about your expenses (e.g., *"How much did Sam spend on food?"* or *"Break down our August expenses"*). The bot reads the Sheet data, performs calculations, and sends a markdown summary response.
*   **🔒 Strict Group Security**: Listens *only* to a designated group chat configured in your settings. It ignores all other group chats and private direct messages.

---

## 🛠️ Prerequisites

Before you start, you will need:
1.  **Node.js** (v18 or higher recommended).
2.  **A Google Cloud Project** with:
    *   **Google Sheets API** enabled.
    *   A **Service Account** and its JSON credentials file.
3.  **A Gemini API Key** (Get a free API key from [Google AI Studio](https://aistudio.google.com/)).
4.  **A Google Sheet** to store the expenses.
5.  **A WhatsApp Group Chat** where the bot will operate.

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Clone the Project
Clone the repository to your local machine:
```bash
git clone https://github.com/vijithsreevalsam/WhatsappBotForExpenseTracker.git
cd WhatsappBotForExpenseTracker
```

### Step 2: Install Dependencies
Install the required Node.js packages:
```bash
npm install
```

### Step 3: Configure Environment Variables
1.  Duplicate the example configuration file:
    ```bash
    cp .env.example .env
    ```
2.  Open your new `.env` file and configure the settings. Here is an explanation of what you need to provide:

```ini
# 1. GROUP FILTERING (STRICT SECURITY)
# The exact name of your WhatsApp group chat (e.g., "Monthly Expenses"). 
# The bot will ignore all other groups.
TARGET_GROUP_NAME="Monthly Expenses"

# 2. GEMINI AI API KEY
# Get yours from https://aistudio.google.com/
GEMINI_API_KEY="your_gemini_api_key_here"
GEMINI_MODEL="gemini-3.6-flash"

# 3. GOOGLE SHEETS INTEGRATION
# The long ID from your sheet URL: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
GOOGLE_SHEET_ID="your_google_sheet_id_here"
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
# Put the complete private key in quotes, retaining newlines (e.g. "-----BEGIN PRIVATE KEY-----\n...")
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# 4. BOT PERSONALIZATION & SENSITIVE DETAILS (Local Only)
# Enter the WhatsApp User ID digits (without @g.us/c.us) and Names of the owners.
# Owner 1 info
OWNER_1_ID="111111111111"
OWNER_1_PHONE="1111111111"
OWNER_1_NAME="Alex"

# Owner 2 info
OWNER_2_ID="222222222222"
OWNER_2_PHONE="2222222222"
OWNER_2_NAME="Sam"
```

---

### Step 4: Google Sheets Connection Setup
To allow the bot to read/write to your Google Sheet:
1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Enable the **Google Sheets API** for your project.
3.  Go to **IAM & Admin > Service Accounts** and create a Service Account.
4.  Create and download a new **JSON Key** for that Service Account.
5.  Open the downloaded JSON key file:
    *   Copy the `client_email` and paste it into `.env` as `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
    *   Copy the `private_key` string (including the `\n` characters) and paste it into `.env` as `GOOGLE_PRIVATE_KEY`.
6.  Open your target Google Sheet in your web browser.
7.  Click the **Share** button in the top right and share the spreadsheet with your Service Account's `client_email` as an **Editor**.

---

### Step 5: Start the Bot & Link WhatsApp
1.  Run the start command in your terminal:
    ```bash
    npm start
    ```
2.  On your first run, a **QR Code** will render directly in your terminal.
3.  Open **WhatsApp** on the phone you want to use for the bot (either your main account or a secondary number).
4.  Go to **Settings > Linked Devices > Link a Device** and scan the terminal's QR code.
5.  Once linked, the bot will initialize, fetch your groups, and save session details in a local `/auth_info` folder. The terminal will log:
    ```text
    ✅ Connected to WhatsApp!
    🎯 TARGET GROUP FOUND: "Monthly Expenses"
    ```

---

## 📖 How to Use the Bot (Commands & Usage)

Once the bot is running in your group chat, you can interact with it using natural language:

### 1. Logging a Text Expense
Send any purchase detail. The bot will detect the amount, choose an appropriate category, and save it.
*   *Group message:* `"Carrefour groceries 145.50 AED"`
*   *Bot reply:*
    > ✅ **Expense Logged!** 💬  
    > 💰 **Amount:** AED145.50  
    > 🏷️ **Category:** Groceries  
    > 👤 **Paid By:** Alex  
    > 📝 **Note:** Carrefour groceries  
    > 📊 Saved to Google Sheet ("Sheet1")  

### 2. Logging an Image Receipt
Upload a picture of a store receipt. You can also add an optional caption.
*   *Group action:* Upload receipt photo.
*   *Bot action:* Vision AI parses the store name, list of items, and the total amount, then logs it to the sheet.

### 3. Modifying/Correcting a Entry
If the bot makes a mistake, or you need to update an entry, simply say:
*   *"Actually the coffee was 20 AED not 15"* (Updates the last logged coffee)
*   *"Change row 15 paid by Sam"* (Updates Row 15 `Paid By` column in Google Sheet)
*   *"Row 8 amount is 120"* (Updates Row 8 `Amount` column to 120)

### 4. Switching Active Sheets
You can manage multiple spreadsheet tabs (e.g. monthly tabs).
*   *Group message:* `"switch sheet to August 2026"`
*   *Bot reply:*
    > 📝 **Sheet Switched!**  
    > 🎯 Active tab is now set to: **"August 2026"**

### 5. Analyzing Expenses
Ask questions about your finances:
*   *Group message:* `"how much did Alex spend on Travel?"`
*   *Bot reply:*
    > 🔍 **Analysis Request Detected**  
    > You asked: *"how much did Alex spend on Travel?"*  
    > Do you want to analyze this tab? Reply **Yes** to proceed.
*   *Group message:* `"Yes"`
*   *Bot reply:* (Generates a clean markdown breakdown after summarizing the sheet rows)

---

## 🐳 Running with Docker
A `Dockerfile` and `docker-compose.yml` are provided if you want to deploy the bot to a home server or VPS.

1.  Build and run the container in detached mode:
    ```bash
    docker-compose up -d --build
    ```
2.  To link WhatsApp (since the QR code prints to the console), view the logs:
    ```bash
    docker-compose logs -f
    ```
3.  Scan the printed QR code.

---

## 🛡️ Security & Privacy Note
All sensitive files are strictly excluded from version control using the `.gitignore` settings:
*   **`.env`**: Holds all local configuration details and API keys.
*   **`auth_info/`**: Stores WhatsApp authentication state and encrypted tokens.
*   **`whatsappexpensetrackerbot-*.json`**: Google Cloud Service Account credentials keys.
*   **`active_sheet.json`**: Remembers which sheet tab was active.

Never upload any of these files to a public GitHub repository. Use `.env.example` to share variables.

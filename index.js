import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs';
import { processTextWithAI, processReceiptImageWithAI, answerQueryWithSheetData } from './aiService.js';
import { saveExpenseToSheet, readExpenseSheet, updateExpenseInSheet } from './sheetsService.js';

// Prevent process crash on network connection drops or library bugs
process.on('unhandledRejection', (reason, promise) => {
  console.warn('⚠️ Warning: Unhandled Promise Rejection. Reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Critical: Uncaught Exception. Error:', err);
});

dotenv.config();

// STRICT SECURITY FILTER: Exact group name from .env
const TARGET_GROUP_NAME = (process.env.TARGET_GROUP_NAME || 'Monthly Expenses').trim().toLowerCase();
let targetGroupJid = null;

let activeSheetName = 'Sheet1';
const activeSheetConfigPath = './active_sheet.json';
let pendingAnalysisQuery = null;

try {
  if (fs.existsSync(activeSheetConfigPath)) {
    const data = JSON.parse(fs.readFileSync(activeSheetConfigPath, 'utf8'));
    if (data.sheetName) {
      activeSheetName = data.sheetName;
    }
  }
} catch (err) {
  console.error('Error loading active_sheet.json config:', err);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n==================================================');
      console.log('📱 SCAN THIS QR CODE IN WHATSAPP -> LINKED DEVICES');
      console.log('==================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reason:', lastDisconnect?.error, 'Reconnecting...', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      } else {
        console.log('Logged out or session invalid. Clearing auth_info and restarting...');
        try {
          fs.rmSync('auth_info', { recursive: true, force: true });
        } catch (err) {
          console.error('Failed to clear auth_info:', err);
        }
        startBot();
      }
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
      console.log(`🔒 Target Expense Group Filter set to: "${process.env.TARGET_GROUP_NAME}"`);
      console.log(`📊 Active spreadsheet tab: "${activeSheetName}"`);

      // Fetch all user's group chats to identify the Target Group JID
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, groupMeta] of Object.entries(groups)) {
          if (groupMeta.subject.trim().toLowerCase() === TARGET_GROUP_NAME) {
            targetGroupJid = jid;
            console.log(`🎯 TARGET GROUP FOUND: "${groupMeta.subject}" (JID: ${targetGroupJid})`);
            break;
          }
        }

        if (!targetGroupJid) {
          console.warn(`⚠️ WARNING: Could not find a group named "${process.env.TARGET_GROUP_NAME}".`);
          console.warn(`Available groups on your account:`, Object.values(groups).map(g => `"${g.subject}"`));
        }
      } catch (err) {
        console.error("Error fetching group chats:", err);
      }
    }
  });

  // Listen for incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];

    // Ignore invalid messages or messages sent by the bot itself
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');

    // 🔴 CRITICAL FILTER: Ignore ALL private chats and ALL non-matching groups
    if (!isGroup) return;

    // Check if this message is from the designated target group
    if (targetGroupJid) {
      if (jid !== targetGroupJid) {
        // Silently ignore messages from other groups
        return;
      }
    } else {
      // Fallback JID matching if fetch hadn't completed yet
      try {
        const groupMeta = await sock.groupMetadata(jid);
        if (groupMeta.subject.trim().toLowerCase() !== TARGET_GROUP_NAME) {
          return; // Ignore
        }
        targetGroupJid = jid; // Cache
      } catch (e) {
        return;
      }
    }

    // If execution reaches here, the message is 100% inside your designated Monthly Expense group!
    let senderName = msg.pushName;
    if (!senderName) {
      const senderJid = msg.key.participant || msg.participant || (msg.key.fromMe ? sock.user?.id : '');
      if (senderJid && !senderJid.endsWith('@g.us')) {
        const rawId = senderJid.split('@')[0].split(':')[0];
        
        const owner1Id = process.env.OWNER_1_ID || '111111111111';
        const owner1Phone = process.env.OWNER_1_PHONE || '1111111111';
        const owner1Name = process.env.OWNER_1_NAME || 'Owner1';
        
        const owner2Id = process.env.OWNER_2_ID || '222222222222';
        const owner2Phone = process.env.OWNER_2_PHONE || '2222222222';
        const owner2Name = process.env.OWNER_2_NAME || 'Owner2';

        if (rawId === owner1Id || rawId === owner1Phone) {
          senderName = owner1Name;
        } else if (rawId === owner2Id || rawId === owner2Phone) {
          senderName = owner2Name;
        } else {
          senderName = rawId;
        }
      } else {
        senderName = 'Group Member';
      }
    }

    // Normalize message content (handles disappearing/ephemeral and view-once messages)
    let messageContent = msg.message;
    if (messageContent?.ephemeralMessage?.message) {
      messageContent = messageContent.ephemeralMessage.message;
    }
    if (messageContent?.viewOnceMessage?.message) {
      messageContent = messageContent.viewOnceMessage.message;
    }
    if (messageContent?.viewOnceMessageV2?.message) {
      messageContent = messageContent.viewOnceMessageV2.message;
    }
    if (messageContent?.documentWithCaptionMessage?.message) {
      messageContent = messageContent.documentWithCaptionMessage.message;
    }

    const textMessage = messageContent?.conversation || 
                        messageContent?.extendedTextMessage?.text || 
                        messageContent?.imageMessage?.caption || 
                        '';
    const isImage = !!messageContent?.imageMessage;

    console.log(`\n📩 Received message in "${process.env.TARGET_GROUP_NAME}" from ${senderName}`);

    // CHECK FOR PENDING ANALYSIS CONFIRMATION
    if (pendingAnalysisQuery && !isImage && textMessage.trim().length > 0) {
      const cleanText = textMessage.trim().toLowerCase();
      const isYes = ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay'].includes(cleanText);
      
      if (isYes) {
        console.log(`🔍 User confirmed analysis request: "${pendingAnalysisQuery.queryText}" on sheet "${activeSheetName}"`);
        await sock.sendMessage(jid, { text: `⏳ *Analyzing sheet tab "${activeSheetName}"... Please wait.*` }, { quoted: msg });
        
        try {
          const sheetData = await readExpenseSheet(activeSheetName);
          if (!sheetData) {
            await sock.sendMessage(jid, { text: `❌ Error reading Google Sheet tab "${activeSheetName}".` }, { quoted: msg });
          } else if (sheetData.length === 0) {
            await sock.sendMessage(jid, { text: `ℹ️ The sheet tab *"${activeSheetName}"* is currently empty!` }, { quoted: msg });
          } else {
            const answer = await answerQueryWithSheetData(pendingAnalysisQuery.queryText, activeSheetName, sheetData);
            await sock.sendMessage(jid, { text: answer }, { quoted: msg });
          }
        } catch (err) {
          console.error("Analysis execution error:", err);
          await sock.sendMessage(jid, { text: `❌ Error executing analysis.` }, { quoted: msg });
        }
        
        pendingAnalysisQuery = null; // Clear state
        return; // Done
      } else {
        // User replied with something other than "yes", clear the pending query state and proceed
        console.log("Pending analysis cancelled or ignored. Clearing pending state.");
        pendingAnalysisQuery = null;
      }
    }

    let aiResult = null;

    if (isImage) {
      console.log(`📷 Receipt Image detected! Processing with Gemini Vision AI...`);
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        );
        aiResult = await processReceiptImageWithAI(buffer, textMessage, senderName);
        if (aiResult) aiResult.isReceipt = true;
      } catch (err) {
        console.error("Error downloading receipt image:", err);
      }
    } else if (textMessage.trim().length > 0) {
      console.log(`💬 Text Message: "${textMessage}" -> Processing with Gemini AI...`);
      aiResult = await processTextWithAI(textMessage, senderName);
      if (aiResult) aiResult.isReceipt = false;
    }

    // Check if AI detected a worksheet switch command
    if (aiResult && aiResult.isCommand && aiResult.sheetName) {
      activeSheetName = aiResult.sheetName;
      console.log(`📝 Sheet switched to: "${activeSheetName}"`);
      try {
        fs.writeFileSync(activeSheetConfigPath, JSON.stringify({ sheetName: activeSheetName }));
      } catch (err) {
        console.error('Failed to save active sheet config:', err);
      }

      const replyText = `📝 *Sheet Switched!*\n` +
        `🎯 Active tab is now set to: *"${activeSheetName}"*\n` +
        `───────────────\n` +
        `ℹ️ Future expenses will be logged into this tab. If the tab doesn't exist, it will be automatically created on the next expense.`;

      await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
      return;
    }

    // Check if AI detected an analytical question/query
    if (aiResult && aiResult.isQuery) {
      pendingAnalysisQuery = {
        queryText: textMessage,
        sheetName: activeSheetName,
        jid: jid
      };
      
      console.log(`🔍 Analytical query detected: "${textMessage}". Awaiting confirmation.`);
      
      const replyText = `🔍 *Analysis Request Detected*\n` +
        `You asked: _"${textMessage}"_\n\n` +
        `I'm currently set to read sheet tab *"${activeSheetName}"*.\n` +
        `Do you want to analyze this tab? Reply *Yes* (or *Y*) to proceed.`;
        
      await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
      return;
    }

    // Check if AI detected a correction command
    if (aiResult && aiResult.isCorrection) {
      const target = aiResult.correctionTarget || 'last';
      const targetRow = aiResult.targetRowNumber || null;
      
      const updates = {};
      if (aiResult.correctionUpdates?.paidBy && aiResult.correctionUpdates.paidBy.trim().length > 0) {
        updates['Paid By'] = aiResult.correctionUpdates.paidBy;
      }
      if (aiResult.correctionUpdates?.amount && aiResult.correctionUpdates.amount > 0.001) {
        updates['Amount'] = aiResult.correctionUpdates.amount;
      }
      if (aiResult.correctionUpdates?.category && aiResult.correctionUpdates.category.trim().length > 0) {
        updates['Category'] = aiResult.correctionUpdates.category;
      }
      if (aiResult.correctionUpdates?.description && aiResult.correctionUpdates.description.trim().length > 0) {
        updates['Description'] = aiResult.correctionUpdates.description;
      }

      console.log(`✏️ Correction request detected for target "${target}" (row: ${targetRow}):`, updates);

      const result = await updateExpenseInSheet(target, updates, activeSheetName, targetRow);
      if (result) {
        let changesText = '';
        for (const key in updates) {
          changesText += `• *${key}:* ~${result.oldValues[key]}~ ➡️ *${updates[key]}*\n`;
        }

        const replyText = `✅ *Expense Corrected! (Row ${result.rowNumber})* ✏️\n` +
          `Updated entry: *"${result.description}"* (Amount: AED${result.amount}, Paid By: ${result.paidBy})\n\n` +
          `*Changes Applied:*\n${changesText}` +
          `───────────────\n` +
          `📊 Sheet: "${activeSheetName}"`;
          
        await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
      } else {
        const errorMsg = targetRow
          ? `⚠️ Could not find or update Row ${targetRow} in tab "${activeSheetName}".`
          : `⚠️ Could not find any matching expense for *"${target}"* to correct in tab "${activeSheetName}".`;
        await sock.sendMessage(jid, { text: errorMsg }, { quoted: msg });
      }
      return;
    }

    // Check if AI detected a valid expense
    if (aiResult && aiResult.isExpense && aiResult.amount) {
      const expenseData = {
        amount: aiResult.amount,
        category: aiResult.category || 'Other',
        description: aiResult.description || textMessage,
        senderName: senderName,
        isReceipt: aiResult.isReceipt,
        rawInput: textMessage || (aiResult.isReceipt ? '[Receipt Image]' : '')
      };

      // 1. Save to Google Sheets (passing the activeSheetName)
      const sheetUrl = await saveExpenseToSheet(expenseData, activeSheetName);

      // 2. Format reply for WhatsApp
      const icon = aiResult.isReceipt ? '📷' : '💬';
      const sheetStatus = sheetUrl
        ? `📊 Saved to Google Sheet ("${activeSheetName}")\n🔗 View: ${sheetUrl}`
        : '⚠️ AI parsed (Sheets disconnected)';

      const replyText = `✅ *Expense Logged!* ${icon}\n` +
        `💰 *Amount:* AED${expenseData.amount}\n` +
        `🏷️ *Category:* ${expenseData.category}\n` +
        `👤 *Paid By:* ${expenseData.senderName}\n` +
        `📝 *Note:* ${expenseData.description}\n` +
        `───────────────\n` +
        `${sheetStatus}`;

      await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
    } else {
      console.log(`ℹ️ AI determined message is NOT an expense log (or invalid format). Ignored.`);
    }
  });
}

startBot();

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
dotenv.config();

let doc = null;

async function getGoogleSheet() {
  if (doc) return doc;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!sheetId || !email || !privateKey) {
    console.warn("⚠️ Google Sheets credentials missing in .env! Row logging will be skipped.");
    return null;
  }

  const auth = new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const serviceDoc = new GoogleSpreadsheet(sheetId, auth);
  await serviceDoc.loadInfo();
  doc = serviceDoc;
  return doc;
}

/**
 * Append expense entry to Google Sheet
 */
export async function saveExpenseToSheet(expenseData, sheetName = 'Sheet1') {
  try {
    const spreadsheet = await getGoogleSheet();
    if (!spreadsheet) return null;

    let sheet = spreadsheet.sheetsByTitle[sheetName];
    if (!sheet) {
      console.log(`Creating new sheet tab: "${sheetName}"...`);
      sheet = await spreadsheet.addSheet({ title: sheetName });
    }
    
    // Ensure header row exists if sheet is empty
    await sheet.setHeaderRow(['Date', 'Paid By', 'Category', 'Amount', 'Description', 'Source', 'Raw Input']);

    await sheet.addRow({
      'Date': new Date().toLocaleDateString('en-US'),
      'Paid By': expenseData.senderName,
      'Category': expenseData.category || 'Other',
      'Amount': expenseData.amount,
      'Description': expenseData.description || '',
      'Source': expenseData.isReceipt ? '📷 Receipt Image' : '💬 Text Message',
      'Raw Input': expenseData.rawInput || ''
    });

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit`;
    console.log(`📊 Successfully saved to Google Sheet: $${expenseData.amount} (${expenseData.category})`);
    console.log(`🔗 Sheet Link: ${sheetUrl}`);
    return sheetUrl;
  } catch (error) {
    console.error("❌ Google Sheets Save Error:", error);
    return null;
  }
}

/**
 * Retrieve all rows from the specified Google Sheet worksheet.
 */
export async function readExpenseSheet(sheetName = 'Sheet1') {
  try {
    const spreadsheet = await getGoogleSheet();
    if (!spreadsheet) return null;

    const sheet = spreadsheet.sheetsByTitle[sheetName];
    if (!sheet) {
      console.warn(`⚠️ Sheet tab "${sheetName}" does not exist in spreadsheet.`);
      return [];
    }

    const rows = await sheet.getRows();
    console.log(`📊 Successfully read ${rows.length} rows from sheet tab "${sheetName}"`);
    
    return rows.map(row => ({
      Date: row.get('Date'),
      'Paid By': row.get('Paid By'),
      Category: row.get('Category'),
      Amount: row.get('Amount'),
      Description: row.get('Description'),
      Source: row.get('Source')
    }));
  } catch (error) {
    console.error("❌ Google Sheets Read Error:", error);
    return null;
  }
}

/**
 * Find and update a specific expense row in the Google Sheet.
 */
export async function updateExpenseInSheet(targetQuery, updates, sheetName = 'Sheet1', targetRowNumber = null) {
  try {
    const spreadsheet = await getGoogleSheet();
    if (!spreadsheet) return null;

    const sheet = spreadsheet.sheetsByTitle[sheetName];
    if (!sheet) {
      console.warn(`⚠️ Sheet tab "${sheetName}" does not exist in spreadsheet.`);
      return null;
    }

    const rows = await sheet.getRows();
    if (rows.length === 0) return null;

    let matchedRow = null;

    if (targetRowNumber) {
      // Map sheet UI row number to 0-indexed array index (Row 1 is header, so Row 2 is index 0)
      const rowIndex = targetRowNumber - 2;
      if (rowIndex >= 0 && rowIndex < rows.length) {
        matchedRow = rows[rowIndex];
      } else {
        console.warn(`⚠️ Row number ${targetRowNumber} is out of bounds (total data rows: ${rows.length}).`);
        return null;
      }
    } else {
      const isLastQuery = targetQuery.toLowerCase().includes('last') || targetQuery.toLowerCase().includes('previous') || targetQuery.trim() === '';

      if (isLastQuery) {
        matchedRow = rows[rows.length - 1];
      } else {
        // Search from bottom up (most recent first)
        const queryLower = targetQuery.toLowerCase();
        for (let i = rows.length - 1; i >= 0; i--) {
          const desc = (rows[i].get('Description') || '').toLowerCase();
          const cat = (rows[i].get('Category') || '').toLowerCase();
          const amt = String(rows[i].get('Amount') || '');
          if (desc.includes(queryLower) || cat.includes(queryLower) || amt.includes(queryLower)) {
            matchedRow = rows[i];
            break;
          }
        }
      }
    }

    if (!matchedRow) {
      console.log(`⚠️ No matching row found in sheet for correction query: "${targetQuery}" (row number: ${targetRowNumber})`);
      return null;
    }

    // Apply updates and store old values for confirmation response
    const oldValues = {};
    for (const key in updates) {
      if (updates[key] !== undefined && updates[key] !== null) {
        oldValues[key] = matchedRow.get(key) || '';
        matchedRow.set(key, updates[key]);
      }
    }

    await matchedRow.save();
    console.log(`📊 Successfully updated sheet row:`, updates);
    
    return {
      rowNumber: matchedRow.rowNumber || (rows.indexOf(matchedRow) + 2),
      description: matchedRow.get('Description') || '',
      amount: matchedRow.get('Amount') || '',
      category: matchedRow.get('Category') || '',
      paidBy: matchedRow.get('Paid By') || '',
      oldValues
    };
  } catch (error) {
    console.error("❌ Google Sheets Update Error:", error);
    return null;
  }
}

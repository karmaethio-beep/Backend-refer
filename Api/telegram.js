import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  serverTimestamp, 
  runTransaction 
} from "firebase/firestore";
import TelegramBot from "node-telegram-bot-api";

// --- Configuration ---
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || ""
};

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Core Logic Functions ---

/**
 * Creates user or merges data and handles referral logic atomically
 */
async function handleUserAndReferral(userData, referralId) {
  const userRef = doc(db, "users", userData.id.toString());
  
  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    let currentUserData;

    if (!userSnap.exists()) {
      // New User Initial Data
      currentUserData = {
        id: userData.id,
        name: userData.first_name,
        photoURL: userData.photo_url || null,
        coins: 0,
        reffer: 0,
        refferBy: referralId || null,
        tasksCompleted: 0,
        totalWithdrawals: 0,
        frontendOpened: true,
        rewardGiven: false,
        createdAt: serverTimestamp()
      };
      transaction.set(userRef, currentUserData);
    } else {
      currentUserData = userSnap.data();
      // Ensure frontendOpened is true
      transaction.update(userRef, { frontendOpened: true });
    }

    // Referral Reward Logic (Atomic & One-Time)
    if (
      currentUserData.refferBy && 
      !currentUserData.rewardGiven && 
      currentUserData.frontendOpened === true
    ) {
      const referrerRef = doc(db, "users", currentUserData.refferBy);
      const rewardRef = doc(db, "ref_rewards", userData.id.toString());

      // 1. Update Referrer
      transaction.update(referrerRef, {
        coins: increment(500),
        reffer: increment(1)
      });

      // 2. Mark Reward as Given for current user
      transaction.update(userRef, { rewardGiven: true });

      // 3. Create Ledger Entry
      transaction.set(rewardRef, {
        userId: userData.id,
        referrerId: currentUserData.refferBy,
        reward: 500,
        createdAt: serverTimestamp()
      });
    }
  });
}

// --- Vercel Serverless Handler ---

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { message } = req.body;

    if (message && message.text) {
      const chatId = message.chat.id;
      const userId = message.from.id;
      const firstName = message.from.first_name;
      
      // Extract photo_url (requires additional call or handling via WebApp initData)
      // For standard bot API, photo_url is usually fetched via getUserProfilePhotos
      const photo_url = ""; 

      // Extract Referral Parameter from /start ref123
      const startMatch = message.text.match(/\/start\s+(.+)/);
      const referralId = startMatch ? startMatch[1] : null;

      // 1. Process Database Logic (Stateless & Atomic)
      await handleUserAndReferral(
        { id: userId, first_name: firstName, photo_url },
        referralId
      );

      // 2. Send Response
      const welcomeImage = "https://i.ibb.co/kZjRKXB/75d849df05a5.jpg";
      const caption = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

      await bot.sendPhoto(chatId, welcomeImage, {
        caption: caption,
        reply_markup: {
          inline_keyboard: [
            [{ text: "▶ Open App", url: "https://karmaethio-beep.github.io/Tg-task-bot/" }],
            [
              { text: "📢 Channel", url: "https://t.me/g_tasks" },
              { text: "🌐 Community", url: "https://t.me/g_tasks_chat" }
            ]
          ]
        }
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing Telegram webhook:', error);
    // Always return 200 to Telegram to avoid retry loops on logic errors
    res.status(200).send('Error Handled');
  }
}

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

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const token = process.env.TELEGRAM_BOT_TOKEN;
// Important: Initialize WITHOUT polling for Vercel
const bot = new TelegramBot(token, { polling: false });

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function handleUserAndReferral(userData, referralId) {
  const userRef = doc(db, "users", userData.id.toString());
  
  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    let currentUserData;

    if (!userSnap.exists()) {
      currentUserData = {
        id: userData.id,
        name: userData.first_name || "User",
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
      transaction.update(userRef, { frontendOpened: true });
    }

    // Referral Logic
    if (referralId && !currentUserData.rewardGiven) {
      const referrerRef = doc(db, "users", referralId);
      const referrerSnap = await transaction.get(referrerRef);

      // Only reward if the referrer actually exists in our DB
      if (referrerSnap.exists()) {
        const rewardRef = doc(db, "ref_rewards", userData.id.toString());
        
        transaction.update(referrerRef, {
          coins: increment(500),
          reffer: increment(1)
        });

        transaction.update(userRef, { rewardGiven: true });

        transaction.set(rewardRef, {
          userId: userData.id,
          referrerId: referralId,
          reward: 500,
          createdAt: serverTimestamp()
        });
      }
    }
  });
}

export default async function handler(req, res) {
  // Telegram sends POST requests
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is running'); 
  }

  try {
    const { message } = req.body;

    if (message && message.text) {
      const chatId = message.chat.id;
      const userId = message.from.id;
      const firstName = message.from.first_name;

      const startMatch = message.text.match(/\/start\s+(.+)/);
      const referralId = startMatch ? startMatch[1] : null;

      // Wait for DB operations to finish
      await handleUserAndReferral(
        { id: userId, first_name: firstName },
        referralId
      );

      const welcomeImage = "https://i.ibb.co/kZjRKXB/75d849df05a5.jpg";
      const caption = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

      // CRITICAL: await the bot response
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

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Bot Error:', error);
    // Return 200 so Telegram stops retrying and crashing your function
    return res.status(200).json({ error: error.message });
  }
}

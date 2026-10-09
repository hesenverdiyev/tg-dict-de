require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.REMOVER_TELEGRAM_TOKEN;
const GROUP_ID = process.env.GROUP_ID; // Kontrol edeceğimiz grup
const bot = new TelegramBot(TOKEN, { polling: true });

// Mesajları dinle
bot.on("message", (msg) => {
  const chatId = msg.chat.id.toString();

  // Sadece belirlenen gruptaki mesajları kontrol et
  if (chatId !== GROUP_ID) return;

  // Kanaldan gelen mesajları kontrol et
  if (msg.forward_from_chat) {
    const text = msg.text || "";

    // "👇" emojisi yoksa sil
    if (!text.includes("👇")) {
      bot.deleteMessage(chatId, msg.message_id)
        .catch(() => {}); // Hata olsa da sessizce geç
    }
  }
});

// .env okurken gereksiz logları kapat
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const googleTTS = require("google-tts-api");
const { EdgeTTS } = require("node-edge-tts");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

if (!process.env.TELEGRAM_TOKEN || !process.env.CHANNEL_ID) {
  console.error("Missing env vars. Set TELEGRAM_TOKEN, CHANNEL_ID in .env");
  process.exit(1);
}

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHANNEL_ID;
const INPUT_TXT = "./tts-sentences.txt";
const TMP_DIR = path.join(__dirname, "tmp");
const EDGE_VOICE = "de-DE-KillianNeural";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

/**
 * Edge TTS ile ses üretir (de-DE-KillianNeural).
 * Başarılıysa mp3 dosya yolunu döndürür.
 */
async function synthWithEdgeTTS(text) {
  const outPath = path.join(TMP_DIR, "tts.mp3");
  const tts = new EdgeTTS({ voice: EDGE_VOICE, lang: "de-DE", rate: "-15%" });
  await tts.ttsPromise(text, outPath);
  return outPath;
}

/**
 * Google TTS ile ses üretir (fallback).
 */
async function synthWithGoogleTTS(text) {
  const url = googleTTS.getAudioUrl(text, {
    lang: "de",
    slow: false,
    host: "https://translate.google.com",
  });

  const outPath = path.join(TMP_DIR, "tts.mp3");

  const response = await axios({
    url,
    method: "GET",
    responseType: "arraybuffer",
  });

  fs.writeFileSync(outPath, response.data);
  return outPath;
}

/**
 * Edge TTS'i dener; hata alırsa Google TTS'e geçer.
 */
async function synthToMp3(text) {
  try {
    console.log(`[TTS] Edge TTS deneniyor (${EDGE_VOICE})...`);
    const outPath = await synthWithEdgeTTS(text);
    console.log("[TTS] Edge TTS başarılı.");
    return outPath;
  } catch (edgeErr) {
    console.warn("[TTS] Edge TTS başarısız, Google TTS'e geçiliyor:", edgeErr.message);
    const outPath = await synthWithGoogleTTS(text);
    console.log("[TTS] Google TTS başarılı.");
    return outPath;
  }
}

async function sendVoice(mp3Path, caption) {
  const stream = fs.createReadStream(mp3Path);
  return bot.sendVoice(CHAT_ID, stream, {
    caption: caption?.slice(0, 1024),
    disable_notification: false,
    contentType: "audio/mpeg", // ✅ Warning çözümü
  });
}

function cleanupFiles() {
  try {
    if (fs.existsSync(INPUT_TXT)) fs.unlinkSync(INPUT_TXT);

    if (fs.existsSync(TMP_DIR)) {
      const files = fs.readdirSync(TMP_DIR);
      files.forEach((file) => {
        const filePath = path.join(TMP_DIR, file);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}

(async () => {
  try {
    if (!fs.existsSync(INPUT_TXT)) {
      console.error("Input text file not found:", INPUT_TXT);
      process.exit(1);
    }

    const text = fs.readFileSync(INPUT_TXT, "utf8").trim();
    if (!text) {
      console.error("Input text file is empty.");
      process.exit(1);
    }

    const mp3 = await synthToMp3(text);
    console.log("MP3 created:", mp3);

    await sendVoice(mp3, "Yuxarıdakı cümlələrin səsləndirilməsi");
    console.log("Voice message sent successfully");

    cleanupFiles();
    console.log("TTS process completed successfully");
  } catch (error) {
    console.error("TTS process failed:", error);
    cleanupFiles();
    process.exit(1);
  }
})();

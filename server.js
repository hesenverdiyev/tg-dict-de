require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const { exec, fork } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Telegram bot setup
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const bot = new TelegramBot(TOKEN, { polling: false });

// ✅ Dosya ve ayarlar
const filePath = path.join(__dirname, "sentences.txt");
const azeFilePath = path.join(__dirname, "aze-sentences.txt");
const LINES_PER_POST = 6;
const POST_INTERVAL = 8 * 60 * 60 * 1000; // 8 saat
let sentences = [];
let azeSentences = [];
let currentIndex = 0;
let azeCurrentIndex = 0;
let postCount = 0; // Günlük paylaşım sayacı

// ✅ sentences.txt yükle
function loadSentences() {
  if (!fs.existsSync(filePath)) {
    console.log("sentences.txt not found.");
    return [];
  }
  const data = fs.readFileSync(filePath, "utf8");
  return data.split("\n").filter((line) => line.trim() !== "");
}

// ✅ aze-sentences.txt yükle
function loadAzeSentences() {
  if (!fs.existsSync(azeFilePath)) {
    console.log("aze-sentences.txt not found.");
    return [];
  }
  const data = fs.readFileSync(azeFilePath, "utf8");
  return data.split("\n").filter((line) => line.trim() !== "");
}

// ✅ Gönderilecek satırları al
function getNextLines() {
  if (sentences.length === 0) return null;

  const lines = [];
  for (let i = 0; i < LINES_PER_POST; i++) {
    lines.push(sentences[currentIndex]);
    currentIndex++;
    if (currentIndex >= sentences.length) {
      currentIndex = 0; // tekrar başa dön
    }
  }
  return lines;
}

// ✅ Azerbaycan cümlesi al
function getNextAzeSentence() {
  if (azeSentences.length === 0) return null;

  const sentence = azeSentences[azeCurrentIndex];
  azeCurrentIndex++;
  if (azeCurrentIndex >= azeSentences.length) {
    azeCurrentIndex = 0; // tekrar başa dön
  }
  return sentence;
}

// ✅ Normal Telegram + TTS gönderme fonksiyonu
function sendNormalPost() {
  const lines = getNextLines();
  if (!lines) return;

  const message = lines
    .map((line, index) => {
      const humanIndex = index + 1;
      return humanIndex % 2 === 1 ? `*${line}*` : line;
    })
    .reduce((acc, line, idx) => {
      acc.push(line);
      if ((idx + 1) % 2 === 0) acc.push("");
      return acc;
    }, [])
    .join("\n");

  bot
    .sendMessage(CHANNEL_ID, message, {
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
    .then(() => console.log("Normal mesaj gönderildi:", new Date().toLocaleString()))
    .catch((err) => {
      console.error("Telegram send error:", err);
    });

  processTTS(lines);
}

// ✅ Azerbaycan cümlesi paylaşım fonksiyonu
function sendAzePost() {
  const azeSentence = getNextAzeSentence();
  if (!azeSentence) {
    console.log("Azerbaycan cümlesi bulunamadı");
    return;
  }

  const message = `Alman dilində tərcüməsini yaz 👇️\n\n*${azeSentence}*`;

  bot
    .sendMessage(CHANNEL_ID, message, {
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
    .then(() => console.log("Azerbaycan cümlesi gönderildi:", new Date().toLocaleString()))
    .catch((err) => {
      console.error("Azerbaycan mesajı gönderme hatası:", err);
    });
}

// ✅ TTS işleme fonksiyonu
function processTTS(lines) {
  const ttsLines = [];
  for (let i = 1; i < lines.length; i += 2) {
    const match = lines[i].match(/^(.*?[.!?])(\s|$)/);
    if (match) ttsLines.push(match[1].trim());
  }

  if (ttsLines.length > 0) {
    const ttsPath = path.join(__dirname, "tts-sentences.txt");
    try {
      fs.writeFileSync(ttsPath, ttsLines.join("\n"), "utf8");

      setTimeout(() => {
        const child = exec("node tts.js", {
          cwd: __dirname,
          timeout: 60000
        }, (error) => {
          if (error) console.error(`tts.js hata: ${error.message}`);
        });

        child.on('error', (error) => {
          console.error('TTS process error:', error);
        });
      }, 500);
    } catch (writeError) {
      console.error('TTS dosya yazma hatası:', writeError);
    }
  } else {
    console.log('TTS için uygun cümle bulunamadı');
  }
}

// ✅ Ana paylaşım fonksiyonu
function sendSentencesAndTTS() {
  postCount++;
  console.log(`Günlük paylaşım #${postCount} başlatılıyor...`);

  if (postCount % 3 === 0) {
    console.log("3. paylaşım - Azerbaycan cümlesi gönderiliyor...");
    sendAzePost();
  } else {
    console.log(`${postCount % 3}. paylaşım - Normal paylaşım gönderiliyor...`);
    sendNormalPost();
  }

  if (postCount >= 3) {
    postCount = 0;
    console.log("Günlük döngü tamamlandı, sayaç sıfırlandı.");
  }
}

// ✅ Sunucu başlatıldığında verileri yükle
sentences = loadSentences();
azeSentences = loadAzeSentences();

// ✅ Sunucu açıldığında ilk mesaj + TTS
sendSentencesAndTTS();

// ✅ Her 8 saatte bir tekrar et
setInterval(sendSentencesAndTTS, POST_INTERVAL);

// ✅ Ping (Render gibi yerlerde uyanık tutmak için)
const url = `https://tg-dict-pl.onrender.com/`;
const interval = 300000;
let firstPingLogged = false;

function reloadWebsite() {
  axios
    .get(url)
    .then((response) => {
      if (!firstPingLogged) {
        console.log(`Ping at ${new Date().toISOString()}: Status ${response.status}`);
        firstPingLogged = true;
      }
    })
    .catch((error) => {
      console.error(`Ping error at ${new Date().toISOString()}:`, error.message);
    });
}
setInterval(reloadWebsite, interval);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(
  session({
    secret: "your-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// EJS ayarları
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Data load/save
const loadData = () => {
  try {
    const data = fs.readFileSync("data/content.json", "utf8");
    return JSON.parse(data);
  } catch (err) {
    return {
      hero: { title: "Welcome", subtitle: "Subtitle", buttonText: "Get Started", backgroundImage: "" },
      about: { title: "About", description: "", mission: "", vision: "", image: "" },
      services: [],
      contact: { address: "", phone: "", email: "" }
    };
  }
};

const saveData = (data) => {
  fs.writeFileSync("data/content.json", JSON.stringify(data, null, 2));
};

if (!fs.existsSync("data")) fs.mkdirSync("data");
if (!fs.existsSync("data/content.json")) saveData(loadData());

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.isAuthenticated) next();
  else res.redirect("/admin/login");
};

// Routes (kısaca)
app.get("/", (req, res) => res.render("index", { data: loadData() }));
app.get("/about", (req, res) => res.render("about", { data: loadData() }));
app.get("/services", (req, res) => res.render("services", { data: loadData() }));
app.get("/contact", (req, res) => res.render("contact", { data: loadData(), message: null }));

app.post("/contact", (req, res) => {
  console.log("Contact form submission:", req.body);
  res.render("contact", { data: loadData(), message: { type: "success", text: "Thank you for your message!" } });
});

app.get("/admin/login", (req, res) => res.render("admin/login", { error: null }));
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "admin" && password === process.env.CHANNEL_ID) {
    req.session.isAuthenticated = true;
    res.redirect("/admin");
  } else res.render("admin/login", { error: "Invalid credentials" });
});
app.get("/admin/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
});
app.get("/admin", requireAuth, (req, res) => res.render("admin/dashboard", { data: loadData() }));

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// ✅ REMOVER CHILD PROCESS OLARAK ÇALIŞTIRMA
const removerPath = path.join(__dirname, "remover.js");
const removerProcess = fork(removerPath);

removerProcess.on("error", (err) => console.error("Remover process error:", err));
removerProcess.on("exit", (code) => console.log(`Remover process exited with code ${code}`));

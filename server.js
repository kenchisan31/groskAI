const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// --- Cấu hình CORS chặt chẽ hơn ---
// Thay YOUR_DOMAIN bằng domain thật của bạn (vd: 'https://groskai.vercel.app')
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    // 'https://YOUR_DOMAIN.vercel.app', // << BỎ COMMENT VÀ ĐỔI THÀNH DOMAIN CỦA BẠN
];

app.use(cors({
    origin: function(origin, callback) {
        // Cho phép không có origin (curl, Postman) trong dev
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
app.use(express.json());

// --- API Keys: ĐỌC TỪ BIẾN MÔI TRƯỜNG (KHÔNG để key thẳng vào code) ---
// Trên Vercel: vào Settings > Environment Variables, thêm:
//   GEMINI_KEY_1 = AIzaSy...
//   GEMINI_KEY_2 = AIzaSy...
//   GEMINI_KEY_3 = AIzaSy...
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
].filter(Boolean); // Lọc bỏ key undefined

if (API_KEYS.length === 0) {
    console.error('⚠️  CẢNH BÁO: Không tìm thấy GEMINI_KEY_* trong biến môi trường!');
}

let currentKeyIndex = 0;

// --- Rate limiting đơn giản (in-memory) ---
const rateLimitMap = new Map();
const RATE_LIMIT = 20;       // max request
const RATE_WINDOW = 60000;   // trong 60 giây

function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + RATE_WINDOW;
    }
    entry.count++;
    rateLimitMap.set(ip, entry);
    return entry.count > RATE_LIMIT;
}

const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

app.post('/api/chat', async (req, res) => {
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (isRateLimited(clientIP)) {
        return res.status(429).json({ error: 'Bạn gửi quá nhiều tin. Chờ chút rồi thử lại nhé!' });
    }

    const { prompt, context } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Không có nội dung' });
    }
    if (prompt.length > 2000) {
        return res.status(400).json({ error: 'Tin nhắn quá dài' });
    }

    // Context do client gửi lên (tối đa 12 lượt)
    const chatContext = Array.isArray(context) ? context.slice(-12) : [];
    chatContext.push({ role: 'user', parts: [{ text: prompt }] });

    let success = false;
    let attempts = 0;
    let finalAiText = 'Hệ thống đang quá tải, bro thử lại sau vài giây nhé! 🔥';

    while (attempts < API_KEYS.length && !success) {
        const ACTIVE_KEY = API_KEYS[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        attempts++;

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${ACTIVE_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: {
                            parts: [{ text: `Bạn là GroskAI - một AI vui tính. Hôm nay là ${today}.` }]
                        },
                        contents: chatContext
                    })
                }
            );

            const data = await response.json();
            if (data.error) { console.error(`Key lỗi: ${data.error.message}`); continue; }

            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                finalAiText = data.candidates[0].content.parts[0].text;
                success = true;
            }
        } catch (error) {
            console.error('Lỗi kết nối:', error.message);
        }
    }

    res.json({ text: finalAiText });
});

app.listen(port, () => console.log(`🚀 Server GroskAI đang chạy tại http://localhost:${port}`));

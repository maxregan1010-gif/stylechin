import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

// Gemma 4 chooses garments from the user profile. Phoenix 1.0 returns raw
// JPEG bytes through the REST API, so image responses need binary handling.
const CLOUDFLARE_ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const CLOUDFLARE_API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const TEXT_MODEL = process.env.CLOUDFLARE_TEXT_MODEL || '@cf/google/gemma-4-26b-a4b-it';
const IMAGE_MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || '@cf/leonardo/phoenix-1.0';
const hasCloudflare = Boolean(
  CLOUDFLARE_ACCOUNT_ID &&
  CLOUDFLARE_API_TOKEN &&
  !CLOUDFLARE_ACCOUNT_ID.includes('اینجا') &&
  !CLOUDFLARE_API_TOKEN.includes('اینجا') &&
  CLOUDFLARE_API_TOKEN.length > 15
);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30kb' }));
app.use('/api/', rateLimit({ windowMs: 10 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const clamp = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const safeList = (value, maxItems = 8) => Array.isArray(value)
  ? value.slice(0, maxItems).map(v => clamp(v, 120)).filter(Boolean)
  : [];

const PANTS_TYPES = {
  straight: {
    label: 'شلوار پارچه‌ای راسته',
    english: 'straight-leg tailored woven trousers, with a clean straight silhouette, definitely not denim',
    fabric: 'پارچه‌ای نرم و خوش‌فرم'
  },
  wide: {
    label: 'شلوار گشاد و دمپاگشاد',
    english: 'wide-leg trousers with a clearly wide silhouette from hip to hem, definitely not denim',
    fabric: 'پارچه‌ی لطیف با ریزش مناسب'
  },
  cargo: {
    label: 'شلوار کارگو چندجیب',
    english: 'utility cargo trousers with clearly visible large side pockets on both legs, cotton twill, not denim',
    fabric: 'کتان ضخیم یا پارچه‌ی کج‌راه'
  },
  chino: {
    label: 'شلوار کتان ساده',
    english: 'plain cotton chino trousers with slanted side pockets, not denim',
    fabric: 'کتان نرم'
  },
  pleated: {
    label: 'شلوار پیلی‌دار',
    english: 'pleated tailored trousers with visible front pleats and a relaxed leg, not denim',
    fabric: 'پارچه‌ی رسمی سبک'
  },
  formal: {
    label: 'شلوار پارچه‌ای رسمی',
    english: 'formal dress trousers with a pressed crease and tailored waistband, not denim',
    fabric: 'پارچه‌ی رسمی'
  },
  jogger: {
    label: 'شلوار جاگر',
    english: 'jogger trousers with a tapered leg and elastic ankle cuffs, not denim',
    fabric: 'پارچه‌ی راحت و سبک'
  },
  linen: {
    label: 'شلوار لینن خنک',
    english: 'lightweight linen trousers with a relaxed straight leg and visible linen weave, not denim',
    fabric: 'لینن خنک'
  },
  corduroy: {
    label: 'شلوار مخمل کبریتی',
    english: 'corduroy trousers with clearly visible fine vertical wales, not denim',
    fabric: 'مخمل کبریتی'
  },
  track: {
    label: 'شلوار ورزشی',
    english: 'athletic track pants made from sports fabric, with subtle side stripes, not denim',
    fabric: 'پارچه‌ی ورزشی سبک'
  },
  tapered: {
    label: 'شلوار راسته با پاچه‌ی جمع‌تر',
    english: 'tapered woven trousers, gently narrowing toward the ankle, not denim',
    fabric: 'پارچه‌ی کتان یا ترکیبی'
  },
  culotte: {
    label: 'شلوار کوتاه و گشاد',
    english: 'wide cropped culotte trousers ending above the ankle, not denim',
    fabric: 'پارچه‌ی سبک با ریزش'
  },
  balloon: {
    label: 'شلوار بگ با فرم منحنی',
    english: 'balloon-leg trousers with a curved roomy silhouette and gathered ankle, not denim',
    fabric: 'کتان نرم یا پارچه‌ی ضخیم'
  },
  drawstring: {
    label: 'شلوار بنددار راحت',
    english: 'relaxed drawstring-waist trousers with a visible fabric waist tie, not denim',
    fabric: 'پنبه‌ای یا لینن'
  },
  jeans: {
    label: 'شلوار جین',
    english: 'denim jeans with visible denim weave and classic jean seams',
    fabric: 'دنیم'
  }
};

const TOP_TYPES = {
  shirt: { label: 'پیراهن دکمه‌دار', english: 'a button-up shirt' },
  tshirt: { label: 'تی‌شرت', english: 'a crew-neck T-shirt' },
  polo: { label: 'پولوشرت', english: 'a polo shirt with a collar' },
  blouse: { label: 'بلوز', english: 'a simple elegant blouse' },
  knit: { label: 'پلیور بافت', english: 'a knitted sweater' },
  sweatshirt: { label: 'دورس', english: 'a crew-neck sweatshirt' },
  hoodie: { label: 'هودی', english: 'a hooded sweatshirt' },
  overshirt: { label: 'پیراهن رویی', english: 'a lightweight overshirt worn as a top layer' },
  cardigan: { label: 'ژاکت جلو باز', english: 'a button-front cardigan' }
};

// Recent choices are tracked to discourage repetitive trouser suggestions.
let recentAutomaticPants = [];
let recentAutomaticTops = [];

function chooseFallbackPantsType(profile = {}) {
  // Used only in demo mode or if the model returns an invalid pants ID.
  // In live mode, the AI model chooses from the complete pants catalog.
  const occasion = profile.occasion || '';
  const season = profile.season || '';
  let candidates = Object.keys(PANTS_TYPES).filter(id => id !== 'jeans');
  if (/رسمی|مهمانی/.test(occasion)) {
    candidates = ['straight', 'wide', 'chino', 'pleated', 'formal', 'tapered'];
  } else if (/ورزش|فعالیت/.test(occasion)) {
    candidates = ['track', 'jogger', 'cargo', 'tapered'];
  } else if (/تابستان|گرم/.test(season)) {
    candidates = ['wide', 'chino', 'linen', 'culotte', 'drawstring', 'straight'];
  }
  const fresh = candidates.filter(id => !recentAutomaticPants.includes(id));
  const pool = fresh.length ? fresh : candidates;
  const id = pool[Math.floor(Math.random() * pool.length)];
  recentAutomaticPants = [id, ...recentAutomaticPants].slice(0, 5);
  return { id, ...PANTS_TYPES[id] };
}

function chooseTopType(profile = {}) {
  const occasion = profile.occasion || '';
  let candidates = Object.keys(TOP_TYPES);
  if (/رسمی|مهمانی/.test(occasion)) {
    candidates = ['shirt', 'blouse', 'knit', 'cardigan'];
  } else if (/ورزش|فعالیت/.test(occasion)) {
    candidates = ['tshirt', 'polo', 'sweatshirt', 'hoodie'];
  }
  const fresh = candidates.filter(id => !recentAutomaticTops.includes(id));
  const pool = fresh.length ? fresh : candidates;
  const id = pool[Math.floor(Math.random() * pool.length)];
  recentAutomaticTops = [id, ...recentAutomaticTops].slice(0, 4);
  return { id, ...TOP_TYPES[id] };
}

function getProfile(raw = {}) {
  const heightValue = Number(raw.heightCm);
  const validHeight = Number.isFinite(heightValue) && heightValue >= 100 && heightValue <= 230
    ? Math.round(heightValue)
    : '';
  const sectionValue = clamp(raw.clothingSection, 40);
  const clothingSection = ['زنانه', 'مردانه', 'بدون ترجیح'].includes(sectionValue)
    ? sectionValue
    : 'بدون ترجیح';
  const usualSizeValue = clamp(raw.usualSize, 16);
  const usualSize = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'نمی‌دانم'].includes(usualSizeValue)
    ? usualSizeValue
    : '';
  const allowedFit = ['اندازه و معمولی', 'کمی آزاد', 'آزاد و گشاد', 'فرقی ندارد'].includes(clamp(raw.fit, 60))
    ? clamp(raw.fit, 60)
    : 'فرقی ندارد';

  return {
    clothingSection,
    heightCm: validHeight,
    appearance: clamp(raw.appearance, 500),
    hairColor: clamp(raw.hairColor, 80),
    eyeColor: clamp(raw.eyeColor, 80),
    colorNotes: clamp(raw.colorNotes, 180),
    occasion: clamp(raw.occasion, 100),
    style: clamp(raw.style, 100),
    season: clamp(raw.season, 80),
    fit: allowedFit,
    usualSize,
    coverage: clamp(raw.coverage, 100),
    budget: clamp(raw.budget, 80),
    avoidColors: clamp(raw.avoidColors, 160),
    extra: clamp(raw.extra, 240)
  };
}

function demoOutfit(profile, pantsChoice, topChoice) {
  const style = profile.style || 'روزمره و راحت';
  const season = profile.season || 'چهارفصل';
  const isFormal = /رسمی|مهمانی/.test(profile.occasion);
  const palette = isFormal ? ['سفید گرم', 'سرمه‌ای', 'خاکستری'] : ['کرم', 'سبز زیتونی', 'قهوه‌ای روشن'];
  const paletteText = palette[0];
  const noOuter = /تابستان|هوای گرم/.test(season);
  return {
    title: `پیشنهاد ${style} برای ${profile.occasion || 'استفاده روزمره'}`,
    summary: `یک ترکیب هماهنگ برای ${season}؛ انتخاب‌ها با توجه به سلیقه، راحتی و موقعیت استفاده انجام شده‌اند.`,
    palette,
    items: {
      top: `${topChoice.label} به رنگ ${paletteText}، با پارچه‌ی باکیفیت و برش مرتب`,
      topType: topChoice.id,
      bottom: `${pantsChoice.label} به رنگ سرمه‌ای یا زیتونی، از جنس ${pantsChoice.fabric} و با بلندی مناسب کفش`,
      bottomType: pantsChoice.id,
      outerwear: noOuter ? 'نیازی به لباس رویی نیست' : 'ژاکت سبک یا کت کوتاه به رنگ زیتونی',
      shoes: isFormal ? 'کفش ساده و مرتب به رنگ قهوه‌ای تیره' : 'کتانی ساده‌ی کرم‌رنگ',
      accessories: 'کیف یا کوله‌ی ساده و یک ساعت یا وسیله‌ی همراه کوچک'
    },
    visualPrompt: `A coordinated ${style} outfit. Show exactly ${topChoice.english}, ${pantsChoice.english}, matching shoes and the listed accessories. Use the palette ${palette.join(', ')}. Faithful e-commerce flat lay, no substitutions.`,
    reasons: [
      'رنگ‌های انتخاب‌شده در کنار هم هماهنگ و قابل استفاده‌اند.',
      `نوع شلوار این بار ${pantsChoice.label} است و در حالت انتخاب خودکار، جین انتخاب نشده است.`,
      'جنس و لایه‌های لباس با فصل و میزان راحتی درخواستی هماهنگ شده‌اند.'
    ],
    alternatives: ['برای تنوع، رنگ بالاپوش را به یکی از رنگ‌های پالت تغییر بده.', 'برای هوای خنک‌تر، یک لایه‌ی سبک اضافه کن.'],
    demo: true
  };
}

function parseJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const trimmed = String(value || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  throw new Error('پاسخ مدل پیشنهاددهنده در قالب JSON معتبر نبود.');
}

async function runCloudflare(model, input) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/ai/run/${model}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false || payload.errors?.length) {
    const details = Array.isArray(payload.errors)
      ? payload.errors.map(item => [item.code, item.message].filter(Boolean).join(': ')).filter(Boolean).join('; ')
      : '';
    const error = new Error(details || `Cloudflare API request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload.result;
}

// The Phoenix 1.0 REST schema returns raw image/jpeg bytes, not JSON with
// result.image. This reader supports that documented binary output and also
// accepts JSON/base64 output if another compatible image model is configured.
async function runCloudflareImage(model, input) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/ai/run/${model}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    let detail = bytes.toString('utf8').slice(0, 1200);
    try {
      const payload = JSON.parse(detail);
      if (Array.isArray(payload.errors)) {
        detail = payload.errors.map(item => [item.code, item.message].filter(Boolean).join(': ')).join('; ');
      } else if (payload.message) {
        detail = payload.message;
      }
    } catch {}
    const error = new Error(detail || `Cloudflare image request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }

  if (!bytes.length) {
    const error = new Error(`Cloudflare returned an empty image response (content-type: ${contentType || 'unknown'}).`);
    error.status = response.status;
    throw error;
  }

  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    let payload;
    try { payload = JSON.parse(bytes.toString('utf8')); }
    catch {
      const error = new Error('پاسخ تصویری با نوع JSON دریافت شد اما قالب آن معتبر نبود.');
      error.status = response.status;
      throw error;
    }
    if (payload?.success === false || payload?.errors?.length) {
      const detail = Array.isArray(payload.errors)
        ? payload.errors.map(item => [item.code, item.message].filter(Boolean).join(': ')).join('; ')
        : 'Cloudflare image generation failed.';
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    const result = payload?.result ?? payload;
    const base64 = typeof result === 'string' ? result : (result?.image || result?.data?.image || result?.b64_json);
    if (typeof base64 === 'string' && base64.length > 100) {
      return { base64: base64.replace(/^data:image\/[^;]+;base64,/, ''), mimeType: 'image/jpeg' };
    }
    const error = new Error(`پاسخ JSON سرویس تصویر، داده‌ی تصویر نداشت (کلیدهای دریافتی: ${Object.keys(result || {}).join(', ') || 'none'}).`);
    error.status = response.status;
    throw error;
  }

  let mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mimeType = 'image/jpeg';
  else if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG') mimeType = 'image/png';
  else if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') mimeType = 'image/webp';

  if (!mimeType) {
    const preview = bytes.subarray(0, 160).toString('utf8').replace(/[\x00-\x1f]+/g, ' ').trim();
    const error = new Error(`Cloudflare returned non-image data (content-type: ${contentType || 'unknown'}; response: ${preview || 'binary data'}).`);
    error.status = response.status;
    throw error;
  }
  return { base64: bytes.toString('base64'), mimeType };
}

function cloudflareErrorMessage(error, task) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return 'کلید دسترسی یا شناسه حساب Cloudflare درست نیست؛ تنظیمات سرور را بررسی کن.';
  if (status === 429 || status === 402) return 'سهمیه روزانه یا ظرفیت سرویس پر شده است. بعداً دوباره امتحان کن و میزان مصرف را در پنل Cloudflare ببین.';
  if (status === 404) return 'مدل یا شناسه حساب پیدا نشد. نام مدل را در تنظیمات سرور بررسی کن.';
  if (status === 410) return 'مدل انتخاب‌شده بازنشسته شده است. نام مدل را در تنظیمات سرور به‌روزرسانی کن.';
  if (status === 400) return `Cloudflare درخواست را نپذیرفت: ${clamp(error?.message, 260)}.`;
  if (status >= 500) return `سرویس Cloudflare موقتاً خطا داد (HTTP ${status}). چند دقیقه بعد دوباره امتحان کن.`;
  if (!status && error?.message) return `ارتباط سرور با Cloudflare برقرار نشد: ${clamp(error.message, 220)}.`;
  return task === 'image'
    ? `ساخت تصویر انجام نشد${status ? ` (HTTP ${status})` : ''}. ${clamp(error?.message, 220)}`
    : `ساخت پیشنهاد لباس انجام نشد${status ? ` (HTTP ${status})` : ''}. ${clamp(error?.message, 220)}`;
}

const stylistInstructions = `تو یک راهنمای حرفه‌ای انتخاب لباس هستی. وظیفه‌ات طراحی یک دست لباس کامل، متنوع و قابل‌پوشیدن بر اساس مشخصات و سلیقه‌ی کاربر است؛ نه قضاوت درباره‌ی ظاهر یا بدن.
قواعد:
1) از همه‌ی اطلاعات فرم استفاده کن: نوع پوشاک زنانه/مردانه/بدون ترجیح، قد (اگر وارد شده)، اندازه‌ی معمول لباس (اگر وارد شده)، قواره‌ی دلخواه، رنگ مو و چشم، رنگ‌های دلخواه و نامطلوب، موقعیت، فصل، سبک، بودجه و راحتی.
2) قد و سایز معمول لباس را فقط برای تناسب، راحتی و بلندی لباس در نظر بگیر. درباره‌ی بدن قضاوت نکن و از عبارت‌هایی مثل «لاغرتر نشان دادن» یا «پنهان کردن» استفاده نکن.
3) خودت باید نوع شلوار را از فهرست مجاز انتخاب کنی. کاربر نباید مجبور باشد نوع شلوار را انتخاب کند. انتخاب را با توجه به فصل، موقعیت، سبک، قد، اندازه‌ی معمول لباس و قواره‌ی دلخواه انجام بده.
4) گزینه‌های مجاز شلوار و شناسه‌ی دقیق آن‌ها:
${Object.entries(PANTS_TYPES).map(([id, item]) => `- ${id}: ${item.label} — ${item.english}`).join('\n')}
5) شناسه‌ی انتخابی را دقیقاً در items.bottomType قرار بده. فقط یکی از شناسه‌های فهرست بالا مجاز است. شلوار جین را پیش‌فرض انتخاب نکن؛ فقط وقتی واقعاً برای سبک و موقعیت مناسب است انتخابش کن. اگر گزینه‌های دیگر مناسب‌اند، از آن‌ها استفاده کن و تا حد امکان انتخاب‌های اخیر را تکرار نکن.
6) شلوار را دقیق معرفی کن: نوع، رنگ، جنس پارچه، برش، بلندی و جزئیات قابل‌دیدن. از عبارت‌های کلی مثل «یک شلوار مناسب» استفاده نکن.
7) بالاپوش، لباس رویی، کفش و وسایل همراه را هم دقیق و هماهنگ انتخاب کن. از تکرار همیشگی تی‌شرت و شلوار جین پرهیز کن.
8) اگر فصل یا موقعیت نیاز به لباس رویی ندارد، مقدار outerwear را «نیازی نیست» قرار بده.
9) فارسی روان و خودمانی بنویس. اصطلاح سخت و واژه‌ی بی‌دلیل انگلیسی در متن‌های قابل‌نمایش کاربر نیاور.
10) visualPrompt را انگلیسی بنویس و دقیقاً همان لباس‌های پیشنهاد اصلی را توصیف کن؛ هیچ لباس تازه یا جایگزین وارد نکن.
11) فقط یک استایل اصلی پیشنهاد بده. جایگزین‌ها فقط در alternatives باشند و وارد تصویر اصلی نشوند.
12) فقط یک شیء JSON معتبر برگردان؛ بدون مقدمه، توضیح یا حصار کد.
ساختار دقیق پاسخ:
{
  "title": "عنوان کوتاه فارسی",
  "summary": "توضیح کوتاه فارسی",
  "palette": ["رنگ یک", "رنگ دو", "رنگ سه"],
  "items": {
    "top": "نوع بالاپوش، رنگ، جنس و برش به فارسی",
    "bottomType": "یکی از شناسه‌های مجاز شلوار",
    "bottom": "نوع شلوار، رنگ، جنس، برش و بلندی به فارسی",
    "outerwear": "لباس رویی یا نیازی نیست",
    "shoes": "کفش مشخص به فارسی",
    "accessories": "وسایل همراه مشخص به فارسی"
  },
  "visualPrompt": "An English description of exactly the same outfit and no other garments.",
  "reasons": ["دلیل یک", "دلیل دو"],
  "alternatives": ["پیشنهاد جایگزین یک", "پیشنهاد جایگزین دو"]
}`;

app.get('/api/status', (_req, res) => {
  res.json({
    mode: hasCloudflare ? 'configured' : 'demo',
    imageEnabled: hasCloudflare,
    textEnabled: hasCloudflare,
    provider: 'Cloudflare Workers AI',
    imageModel: IMAGE_MODEL,
    textModel: TEXT_MODEL
  });
});

app.post('/api/style', async (req, res) => {
  const profile = getProfile(req.body || {});
  const fallbackPants = chooseFallbackPantsType(profile);
  const topChoice = chooseTopType(profile);

  if (!profile.appearance && !profile.hairColor && !profile.colorNotes && !profile.style) {
    return res.status(400).json({ error: 'لطفاً دست‌کم یکی از توضیحات ظاهر، رنگ‌ها یا سلیقه‌ی لباس را وارد کن.' });
  }
  if (!hasCloudflare) return res.json(demoOutfit(profile, fallbackPants, topChoice));

  try {
    const pantsCatalog = Object.entries(PANTS_TYPES)
      .map(([id, item]) => `${id}: ${item.label} | ${item.english} | جنس پیشنهادی: ${item.fabric}`)
      .join('\n');
    const recentTypes = recentAutomaticPants.length ? recentAutomaticPants.join('، ') : 'هنوز پیشنهادی ثبت نشده';
    const userPrompt = `اطلاعات فرم کاربر را بررسی کن و خودت از بین مدل‌های زیر یک نوع شلوار انتخاب کن. کاربر هیچ نوع شلواری را انتخاب نکرده است؛ انتخاب کاملاً با توست.\n\nمشخصات کاربر:\n${JSON.stringify(profile, null, 2)}\n\nفهرست کامل مدل‌های مجاز شلوار:\n${pantsCatalog}\n\nبالاپوش هماهنگ این ترکیب: ${topChoice.label} (English: ${topChoice.english}).\n\nمدل‌های شلوار استفاده‌شده در پیشنهادهای اخیر: ${recentTypes}. اگر با فصل و موقعیت سازگار است، این بار سراغ نوع دیگری برو.\n\nراهنمای انتخاب: فصل، موقعیت، سلیقه، قد، اندازه‌ی معمول لباس و قواره‌ی دلخواه را در نظر بگیر. یک انتخاب مشخص انجام بده و شناسه‌ی آن را در items.bottomType بنویس. همیشه سراغ جین نرو؛ اگر شلوار پارچه‌ای راسته، گشاد، کارگو، کتان، پیلی‌دار، رسمی، جاگر، لینن، مخمل کبریتی، ورزشی، مخروطی، کوتاه و گشاد، بگ یا بنددار مناسب‌تر است، همان را انتخاب کن.\n\nدر متن فارسی رنگ، جنس، برش و بلندی شلوار را دقیق مشخص کن. visualPrompt باید انگلیسی باشد و دقیقاً همان نوع شلوار با همان رنگ و جنس را نشان دهد. هیچ شلوار یا لباس جایگزینی وارد تصویر نکن. خروجی فقط JSON معتبر با ساختار خواسته‌شده باشد.`;

    const result = await runCloudflare(TEXT_MODEL, {
      messages: [
        { role: 'system', content: stylistInstructions },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2200,
      temperature: 0.55,
      top_p: 0.9,
      response_format: { type: 'json_object' }
    });

    const responseCandidate = result?.response ?? result?.text ?? result?.choices?.[0]?.message?.content ?? result;
    const outfit = parseJson(responseCandidate);
    const rawItems = outfit.items && typeof outfit.items === 'object' ? outfit.items : {};
    const selectedType = clamp(rawItems.bottomType, 40).toLowerCase();
    const pantsChoice = PANTS_TYPES[selectedType]
      ? { id: selectedType, ...PANTS_TYPES[selectedType] }
      : fallbackPants;
    recentAutomaticPants = [pantsChoice.id, ...recentAutomaticPants.filter(id => id !== pantsChoice.id)].slice(0, 5);

    const palette = safeList(outfit.palette, 5).length >= 2 ? safeList(outfit.palette, 5) : ['کرم', 'سرمه‌ای', 'زیتونی'];
    const bottomText = clamp(rawItems.bottom, 260);
    const mentionsWrongDenim = pantsChoice.id !== 'jeans' && /(جین|دنیم|\bjeans?\b|\bdenim\b)/i.test(bottomText);
    const mentionsOtherType = Object.entries(PANTS_TYPES).some(([id, item]) => id !== pantsChoice.id && item.label !== 'شلوار جین' && bottomText.includes(item.label));
    const bottomDescription = (!bottomText || mentionsWrongDenim || mentionsOtherType)
      ? `${pantsChoice.label} به رنگ ${palette[1] || palette[0]}، از جنس ${pantsChoice.fabric}، با برش ${pantsChoice.english.split(',')[0]} و بلندی مناسب کفش`
      : `${pantsChoice.label}؛ ${bottomText}`;

    let topDescription = clamp(rawItems.top, 240);
    if (!topDescription || /(تی.?شرت|پیراهن|پولوشرت|بلوز|پلیور|دورس|هودی|ژاکت)/.test(topDescription) === false) {
      topDescription = `${topChoice.label} با رنگ و جنس هماهنگ با پالت پیشنهادی`;
    } else if (!topDescription.includes(topChoice.label)) {
      topDescription = `${topChoice.label}؛ ${topDescription}`;
    }

    const outerwear = clamp(rawItems.outerwear, 220) || 'نیازی نیست';
    const shoes = clamp(rawItems.shoes, 180) || 'کتانی ساده و هماهنگ با رنگ لباس';
    const accessories = clamp(rawItems.accessories, 220) || 'کیف ساده و یک وسیله‌ی همراه کوچک';
    const visualPrompt = `One exact coordinated outfit: ${topChoice.english}; ${pantsChoice.english}, ${bottomDescription}; outerwear: ${outerwear}; shoes: ${shoes}; accessories: ${accessories}. Exact palette: ${palette.join(', ')}. Product photography, show every garment fully, do not replace any item.`;

    return res.json({
      title: clamp(outfit.title, 120) || 'استایل پیشنهادی تو',
      summary: clamp(outfit.summary, 500) || 'یک ترکیب هماهنگ بر اساس سلیقه و موقعیت انتخاب‌شده.',
      palette,
      items: {
        top: topDescription,
        topType: topChoice.id,
        bottom: bottomDescription,
        bottomType: pantsChoice.id,
        outerwear,
        shoes,
        accessories
      },
      visualPrompt,
      reasons: safeList(outfit.reasons, 4).length ? safeList(outfit.reasons, 4) : ['نوع شلوار با فصل، موقعیت و قواره‌ی دلخواه هماهنگ انتخاب شده است.'],
      alternatives: safeList(outfit.alternatives, 3),
      demo: false
    });
  } catch (error) {
    console.error('Cloudflare stylist API error:', { status: error?.status || null, message: error?.message || String(error) });
    return res.status(502).json({ error: cloudflareErrorMessage(error, 'text') });
  }
});

app.post('/api/image', async (req, res) => {
  if (!hasCloudflare) {
    return res.status(503).json({ error: 'برای ساخت تصویر واقعی، ابتدا کلید Cloudflare را در تنظیمات سرور وارد کن.' });
  }

  const outfit = req.body?.outfit || {};
  const items = outfit.items || {};
  const pantsChoice = PANTS_TYPES[items.bottomType] || PANTS_TYPES.straight;
  const topChoice = TOP_TYPES[items.topType] || TOP_TYPES.shirt;
  const palette = safeList(outfit.palette, 5).join('، ');
  const noDenimRule = items.bottomType !== 'jeans'
    ? 'The trousers are NOT jeans and NOT denim. Do not draw denim texture, five-pocket jean construction, jean seams, blue jeans, or denim jackets.'
    : 'The trousers are denim jeans. Preserve the specified jeans cut and colour.';
  const outerwearText = clamp(items.outerwear, 220);
  const noOuterwear = /نیازی نیست|ندارد|بدون لباس رویی|بدون لایه/i.test(outerwearText);


  const negativePrompt = [
    'wrong garment type', 'wrong trouser cut', 'extra trousers', 'extra shirts', 'second outfit',
    'clothing collage', 'fashion mood board', 'wrong colours', 'unlisted garments',
    'unlisted accessories', 'human model', 'person', 'body', 'mannequin', 'text', 'letters',
    'labels', 'logos', 'watermark', 'cropped clothing'
  ];
  if (items.bottomType !== 'jeans') {
    negativePrompt.push('blue jeans', 'denim texture', 'five-pocket jeans', 'denim jacket');
  } else {
    negativePrompt.push('denim jacket');
  }

  let visualNotes = clamp(outfit.visualPrompt, 1100);
  if (items.bottomType !== 'jeans' && /(jeans?|denim|جین|دنیم)/i.test(visualNotes)) {
    visualNotes = `A precise fashion flat lay featuring ${topChoice.english} and ${pantsChoice.english}, with the exact colour, fabric and cut described above. No substitutions.`;
  }

  const imagePrompt = `Create one beautiful, photorealistic premium fashion e-commerce flat-lay photograph, top-down camera view, vertical portrait composition, on a warm ivory/light-stone studio surface. This is a precise catalog photograph of ONE outfit, not a mood board or a collage. Arrange the actual garments neatly with natural fabric folds, visible stitching, realistic textures, soft editorial daylight and clean styling.

EXACT GARMENT LIST — follow this list as a product specification. Render each listed item once, with the same garment type, colour, fabric and cut. Never substitute an item:
1. TOP: ${topChoice.english}. Exact details: ${clamp(items.top, 240)}.
2. TROUSERS: ${pantsChoice.english}. Exact details: ${clamp(items.bottom, 260)}.
3. OUTERWEAR: ${noOuterwear ? 'No outerwear. Do not add a jacket, coat, cardigan or extra layer.' : clamp(outerwearText, 220)}.
4. SHOES: ${clamp(items.shoes, 180)}. Show one matching pair.
5. ACCESSORIES: ${clamp(items.accessories, 220)}. Show only the stated accessories.

COLOUR PALETTE: ${palette}.

The following English visual notes only clarify the exact same outfit; they must never override the garment list above: ${visualNotes}.

${noDenimRule}

Composition: show the full top and the entire trousers clearly, with enough space to see the exact leg shape, waistband, pockets, hem and fabric. Put shoes below the trousers and accessories in a small separate group. Keep every item fully inside the frame. Use only the listed colours. No person, no body, no mannequin, no text, no labels, no logos, no watermark, no extra garments, no second outfit, no collage.`.slice(0, 4200);

  try {
    const generated = await runCloudflareImage(IMAGE_MODEL, {
      prompt: imagePrompt,
      negative_prompt: negativePrompt.join(', '),
      width: 768,
      height: 1024,
      guidance: 8.8,
      num_steps: 30
    });
    return res.json({ image: `data:${generated.mimeType};base64,${generated.base64}`, demo: false, provider: 'Cloudflare Workers AI', model: IMAGE_MODEL });
  } catch (error) {
    console.error('Cloudflare image API error:', { status: error?.status || null, message: error?.message || String(error) });
    return res.status(502).json({ error: cloudflareErrorMessage(error, 'image') });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`استایل‌چین روی http://localhost:${PORT} اجرا شد.`);
  console.log(`Mode: ${hasCloudflare ? 'Cloudflare Workers AI' : 'DEMO (Cloudflare credentials missing)'}`);
  console.log(`Text model: ${TEXT_MODEL}`);
  console.log(`Image model: ${IMAGE_MODEL}`);
  console.log('Image output parser: binary JPEG/PNG/WebP + JSON/base64');
});

# رفع موقع Salah Phone على الإنترنت

الموقع يحفظ الطلبيات والحسابات في ملف قاعدة بيانات (SQLite)، ويحفظ صور المنتجات في مجلد.
لذلك **يجب أن تكون الاستضافة بقرص دائم** (Persistent disk). الاستضافات المجانية التي تمسح الملفات عند كل إعادة تشغيل
(مثل خطة Render المجانية) **ستحذف كل الطلبيات والحسابات**، فلا تستعملها.

هناك طريقتان:

| | الطريقة 1: خادم VPS (موصى بها) | الطريقة 2: Render.com |
|---|---|---|
| السعر التقريبي | 4 – 7 $ / شهر | حوالي 7.25 $ / شهر (خطة Starter + قرص 1 GB) |
| الصعوبة | متوسطة (أوامر نسخ ولصق) | سهلة (من المتصفح) |
| HTTPS | تلقائي (Caddy) | تلقائي |

تحتاج في الحالتين إلى **بطاقة دفع دولية** (Visa / Mastercard) وإلى **اسم نطاق** (Domain) مثل `salahphone.com`
(حوالي 10 – 15 $ / سنة من Namecheap أو Hostinger أو Cloudflare).

---

## الطريقة 1: خادم VPS

### 1. شراء الخادم
اشترِ VPS بنظام **Ubuntu 24.04**، و1 GB من الذاكرة (RAM) تكفي. أمثلة: Hostinger VPS (KVM 1)، Hetzner، Contabo، DigitalOcean.
بعد الشراء تحصل على **عنوان IP** (مثلا `203.0.113.10`) وكلمة مرور `root`.

### 2. ربط اسم النطاق بالخادم
في لوحة التحكم عند مزوّد النطاق، قسم **DNS**، أضف سجلّين:

| النوع | الاسم | القيمة |
|---|---|---|
| A | `@` | عنوان IP الخاص بالخادم |
| A | `www` | عنوان IP الخاص بالخادم |

قد يستغرق التفعيل من بضع دقائق إلى بضع ساعات.

### 3. تثبيت الموقع
ادخل إلى الخادم (من ويندوز استعمل PowerShell، ومن الهاتف تطبيق Termius):

```bash
ssh root@203.0.113.10
```

ثم نفّذ:

```bash
apt update && apt install -y git
git clone https://github.com/djennad/salah-phone.git /opt/salah-phone
cd /opt/salah-phone
bash deploy/setup-vps.sh
```

> إذا كان المستودع **خاصًا (Private)**، سيطلب `git clone` اسم المستخدم وكلمة مرور. ضع اسم مستخدم GitHub،
> وفي مكان كلمة المرور ضع **Personal access token** (من GitHub ← Settings ← Developer settings ← Fine-grained tokens،
> مع صلاحية القراءة فقط على هذا المستودع).

السكربت يطلب منك:
- اسم النطاق
- بريد الإدارة وكلمة مرورها
- هل تريد المنتجات التجريبية

ثم يقوم تلقائيًا بـ:
- تثبيت Docker
- تفعيل الجدار الناري
- تشغيل الموقع مع **شهادة HTTPS مجانية**
- برمجة **نسخة احتياطية كل ليلة**

بعدها افتح `https://salahphone.com` ثم `https://salahphone.com/admin`.

### 4. أوامر مفيدة
```bash
cd /opt/salah-phone
docker compose logs -f app                 # رؤية سجل الموقع
docker compose restart app                 # إعادة التشغيل
git pull && docker compose up -d --build   # تحديث الموقع بعد أي تعديل في الكود
docker compose exec app node --no-warnings scripts/backup.js   # نسخة احتياطية فورية
```

### 5. النسخ الاحتياطية
النسخ تُحفظ داخل الخادم (آخر 14 نسخة). انسخها إلى حاسوبك من وقت لآخر:

```bash
# على الخادم
docker compose cp app:/data/backups ./backups
# على حاسوبك
scp -r root@203.0.113.10:/opt/salah-phone/backups ./salah-phone-backups
```

**للاسترجاع من نسخة:**
```bash
docker compose stop app
docker compose cp ./backups/salah-phone-XXXX.db app:/data/salah-phone.db
docker compose start app
```

---

## الطريقة 2: Render.com (بدون إدارة خادم)

1. أنشئ حسابًا على <https://render.com> وسجّل الدخول بحساب GitHub.
2. اختر **New ← Blueprint** ثم اختر المستودع `djennad/salah-phone`. Render سيقرأ الملف `render.yaml` تلقائيًا.
3. عند الطلب، أدخل `ADMIN_EMAIL` و `ADMIN_PASSWORD`، ثم اضغط **Apply**.
4. بعد انتهاء البناء يعطيك Render رابطًا مثل `salah-phone.onrender.com`.
5. لربط اسم النطاق: **Settings ← Custom Domains**، أضف النطاق ثم اتبع تعليمات DNS التي يعطيها Render.

للنسخ الاحتياطي على Render: افتح **Shell** من لوحة الخدمة ونفّذ `node scripts/backup.js`
(النسخ تُحفظ في `/data/backups` على القرص الدائم).

---

## بعد الرفع مباشرة
1. ادخل `/admin` وغيّر كلمة مرور الإدارة إذا استعملت كلمة سهلة.
2. من **Paramètres**: ضع رقم الهاتف، رقم واتساب (بصيغة `213XXXXXXXXX`)، العنوان، روابط فيسبوك وإنستغرام.
3. من **Livraison**: راجع أسعار التوصيل حسب شركة التوصيل التي تتعامل معها.
4. إذا شغّلت المنتجات التجريبية، احذفها أو عدّلها وأضف منتجاتك الحقيقية مع الصور.
5. سجّل حسابًا تجريبيًا كمصلح وجرّب الموافقة عليه، ثم جرّب طلبية كاملة.

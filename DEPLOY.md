# رفع موقع Salah Phone على الإنترنت

الموقع يحفظ الطلبيات والحسابات في ملف قاعدة بيانات (SQLite)، ويحفظ صور المنتجات في مجلد.
لذلك **يجب أن تكون الاستضافة بقرص دائم** (Persistent disk). الاستضافات المجانية التي تمسح الملفات عند كل إعادة تشغيل
(مثل خطة Render المجانية) **ستحذف كل الطلبيات والحسابات**، فلا تستعملها.

هناك طريقتان:

| | الطريقة 1: خادم VPS (موصى بها) | الطريقة 2: Render.com |
|---|---|---|
| السعر التقريبي | 4 – 7 $ / شهر | حوالي 7.25 $ / شهر (Starter + قرص 1 GB) |
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

**التكلفة:** خطة **Starter** (حوالي 7 $ / شهر) + قرص 1 GB (حوالي 0.25 $ / شهر).
الخطة المجانية **لا تدعم القرص الدائم**، ومعها تضيع الطلبيات والحسابات عند كل إعادة تشغيل.

### 1. إنشاء الموقع
1. أنشئ حسابًا على <https://render.com> باستعمال **GitHub** (زر *Sign up with GitHub*).
2. أضف بطاقة الدفع من **Account Settings ← Billing**.
3. من لوحة Render اختر **New ← Blueprint**.
4. اضغط **Connect GitHub** واسمح لـ Render بالوصول إلى المستودع `djennad/salah-phone`، ثم اختره.
5. Render يقرأ الملف `render.yaml` ويعرض خدمة واحدة اسمها `salah-phone` (Starter، فرانكفورت، قرص 1 GB).
6. يطلب منك قيمتين:
   - `ADMIN_EMAIL`: بريد حساب الإدارة
   - `ADMIN_PASSWORD`: كلمة مرور قوية (8 أحرف على الأقل)
7. اضغط **Deploy Blueprint** وانتظر 2 – 5 دقائق حتى تظهر الحالة **Live**.

الموقع يعمل الآن على رابط مثل `https://salah-phone.onrender.com`، والإدارة على `https://salah-phone.onrender.com/admin`.

> المنتجات التجريبية تُضاف في أول تشغيل (`SEED_DEMO=1`) لترى الموقع ممتلئًا. احذفها أو عدّلها من لوحة الإدارة
> قبل الإعلان عن الموقع، لأن أسعارها وكمياتها غير حقيقية.

### 2. ربط اسم النطاق (اختياري)
1. في Render افتح الخدمة ← **Settings ← Custom Domains ← Add Custom Domain** وأدخل `salahphone.com`، ثم أضف `www.salahphone.com` أيضًا.
2. Render يعطيك السجلات التي يجب إضافتها في DNS عند مزوّد النطاق:
   - غالبًا سجل **CNAME** للاسم `www` يشير إلى `salah-phone.onrender.com`
   - وسجل **A** (أو ALIAS) للنطاق الرئيسي `@`
   
   انسخ القيم كما يعرضها Render بالضبط.
3. اضغط **Verify**. شهادة HTTPS تُستخرج تلقائيًا.

### 3. التحديثات
كل تعديل يُدمج في الفرع `main` على GitHub يُنشر تلقائيًا (Auto-Deploy). الطلبيات والحسابات والصور تبقى محفوظة في القرص.

### 4. النسخ الاحتياطية
Render يأخذ لقطة (snapshot) يومية للقرص، ويمكن استرجاعها من **Disks** في صفحة الخدمة.
لنسخة يدوية افتح **Shell** من صفحة الخدمة ونفّذ:
```bash
node --no-warnings scripts/backup.js
```
تُحفظ النسخ في `/var/data/backups`.

### 5. إذا ظهر خطأ
افتح **Logs** في صفحة الخدمة وانسخ آخر الأسطر. هذه أهم الأسباب:
- **`Cannot find module 'node:sqlite'`**: نسخة Node قديمة. تأكد أن `NODE_VERSION` قيمته `22` في **Environment**.
- **الموقع يعمل لكن الطلبيات تختفي بعد إعادة التشغيل**: القرص غير مركّب. تحقق من **Disks**: يجب أن يكون المسار `/var/data`.
- **نسيت بريد أو كلمة مرور الإدارة**: الحساب يُنشأ مرة واحدة فقط في أول تشغيل، وتغيير `ADMIN_PASSWORD` بعد ذلك لا يغيّره.
  افتح **Shell** من صفحة الخدمة ونفّذ:
  ```bash
  npm run reset-admin                                  # يعرض بريد حساب الإدارة
  npm run reset-admin -- البريد كلمة-المرور-الجديدة     # يغيّر كلمة المرور
  ```

---

## بعد الرفع مباشرة
1. ادخل `/admin` وغيّر كلمة مرور الإدارة إذا استعملت كلمة سهلة.
2. من **Paramètres**: ضع رقم الهاتف، رقم واتساب (بصيغة `213XXXXXXXXX`)، العنوان، روابط فيسبوك وإنستغرام.
3. من **Livraison**: راجع أسعار التوصيل حسب شركة التوصيل التي تتعامل معها.
4. إذا شغّلت المنتجات التجريبية، احذفها أو عدّلها وأضف منتجاتك الحقيقية مع الصور.
5. سجّل حسابًا تجريبيًا كمصلح وجرّب الموافقة عليه، ثم جرّب طلبية كاملة.

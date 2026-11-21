# ZAAI Owner Control Center

تشغيل الموقع ولوحة الإدارة:

```powershell
cd "D:\My project in Html and CSS\ZAAI"
$env:PORT="5510"
npm start
```

صفحة المتجر: `http://127.0.0.1:5510`

صفحة دخول المالك: `http://127.0.0.1:5510/admin/login`

حساب المالك الأولي يُنشأ تلقائيًا عند أول تشغيل ويظهر في نافذة الخادم. يمكن لاحقًا تغيير كلمة المرور من قسم الإعدادات في لوحة الإدارة.

لتهيئة حساب دائم دون إنشاء حساب تلقائي:

```powershell
$env:ZAAI_OWNER_EMAIL="owner@example.com"
$env:ZAAI_OWNER_PASSWORD="كلمة مرور قوية لا تقل عن 12 حرفًا"
$env:ZAAI_SESSION_SECRET="قيمة سرية عشوائية طويلة"
$env:PORT="5510"
npm start
```

قاعدة البيانات تُحفظ في `.data/zaai.sqlite` والملفات المرفوعة في `uploads/`. كلاهما مستبعدان من Git.

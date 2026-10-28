# RedX Reseller Panel — নতুনদের জন্য

এটি একটি **starter project**: লাল-কালো responsive UI, সার্ভার-ভিত্তিক অ্যাকাউন্ট, অর্ডার, পেমেন্ট রিকোয়েস্ট এবং অ্যাডমিন ফিচার রয়েছে। এটি production-ready payment gateway নয়।

## আপনার কম্পিউটারে চালানোর ধাপ

1. Node.js 20 বা তার নতুন LTS সংস্করণ ইনস্টল করুন।
2. ZIP ফাইলটি extract করুন এবং এই ফোল্ডারে Terminal/Command Prompt খুলুন।
3. `.env.example` কপি করে `.env` নাম দিন।
4. `.env` ফাইলে `SESSION_SECRET`-এ দীর্ঘ random secret দিন এবং `ADMIN_USERNAME`, `ADMIN_PASSWORD` নিজের মতো পরিবর্তন করুন। `.env` GitHub-এ আপলোড করবেন না।
5. চালান:
   ```bash
   npm install
   npm start
   ```
6. ব্রাউজারে `http://localhost:3000` খুলুন। `.env`-এ দেওয়া admin username/password দিয়ে লগইন করুন।
7. অন্য অ্যাকাউন্ট পরীক্ষা করতে Register ব্যবহার করুন। নতুন রিসেলারদের ব্যালেন্স শূন্য থেকে শুরু হবে।

## কীভাবে ফিচারগুলো কাজ করে

- **রেজিস্ট্রেশন/লগইন:** পাসওয়ার্ড hash করে SQLite-এ রাখা হয়; plain text পাসওয়ার্ড সংরক্ষণ করা হয় না।
- **অর্ডার:** পর্যাপ্ত ব্যালেন্স থাকলে সার্ভার অর্ডারের টাকা কেটে নেয়।
- **পেমেন্ট:** রিসেলার পেমেন্ট রেফারেন্স জমা দেয়। অ্যাডমিন সত্যিকারের পেমেন্ট যাচাই করে অনুমোদন করলে তবেই ব্যালেন্স যোগ হয়।
- **অ্যাডমিন:** ইউজারদের ব্যালেন্স দেখা/পরিবর্তন এবং pending payment request approve/reject করতে পারে।

## GitHub ও অনলাইনে প্রকাশ

GitHub-এ source code রাখতে পারেন, কিন্তু শুধু GitHub Pages-এ এই পুরো অ্যাপ চলবে না: সেখানে Node.js server এবং SQLite চালানো যায় না। Node.js hosting ও persistent database/storage-সহ সার্ভার দরকার। `.env`, `data.sqlite`, পাসওয়ার্ড, API key বা payment secret কখনো public repository-তে দেবেন না।

## Production-এর আগে অবশ্যই করুন

- HTTPS চালু করুন; hosting-এ secure session cookie ঠিকমতো configure করুন।
- MemoryStore-এর বদলে persistent session store ব্যবহার করুন।
- SQLite ফাইল persistent disk-এ রাখুন অথবা managed database ব্যবহার করুন।
- Payment provider-এর official API/webhook এবং signature verification যুক্ত করুন; শুধু user-entered TrxID দেখে স্বয়ংক্রিয়ভাবে টাকা যোগ করবেন না।
- Admin-এর জন্য 2FA, audit log, backups, CSRF protection এবং আরও শক্ত rate limits যোগ করুন।
- বাস্তব গ্রাহকের টাকা নেওয়ার আগে স্থানীয় আইন, provider-এর শর্ত এবং নিরাপত্তা বিশেষজ্ঞের পরামর্শ যাচাই করুন।

**নোট:** প্রথমবার অ্যাডমিন অ্যাকাউন্ট তৈরি হওয়ার পর `.env`-এর admin password বদলালে ডেটাবেসে থাকা পুরোনো অ্যাকাউন্টের password স্বয়ংক্রিয়ভাবে বদলাবে না। তাই সেটআপের সময়ই শক্ত পাসওয়ার্ড বেছে নিন।

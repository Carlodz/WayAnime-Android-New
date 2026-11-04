// يُشغَّل بعد `cap add android`: ينسخ MainActivity (البروكسي المحلي) ويعدّل الـ Manifest
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), app = path.join(root, 'android', 'app', 'src', 'main');
if (!fs.existsSync(app)) { console.error('android/ غير موجود — شغّل: npx cap add android'); process.exit(1); }
const dst = path.join(app, 'java', 'com', 'wayanime', 'app'); fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(root, 'native', 'MainActivity.java'), path.join(dst, 'MainActivity.java'));
const mf = path.join(app, 'AndroidManifest.xml'); let x = fs.readFileSync(mf, 'utf8');
if (!/usesCleartextTraffic/.test(x)) x = x.replace('<application', '<application android:usesCleartextTraffic="true"');
for (const p of ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS', 'android.permission.WAKE_LOCK']) {
  if (!x.includes(p)) x = x.replace('</manifest>', '    <uses-permission android:name="' + p + '" />\n</manifest>');
}
fs.writeFileSync(mf, x);
console.log('prepare-android: OK');

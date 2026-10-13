# Hosting TCS di Hostinger VPS — Ubuntu 24.04 LTS

Panduan ini untuk VPS Ubuntu 24.04 biasa dengan Nginx. Domain contoh adalah `tcsmonitor.online`. Belum ada perubahan yang dilakukan pada VPS atau DNS oleh Codex.

Website terdiri dari HTML dan JavaScript. Nginx menyajikan file website, lalu browser terhubung langsung ke Supabase. Tidak perlu memasang Node.js, PM2, atau database PostgreSQL pada VPS untuk menjalankan website ini.

## 1. Ambil informasi VPS

Aktifkan VPS, pilih Ubuntu 24.04 LTS, lalu buka pengelolaan VPS di hPanel. Catat IP publik IPv4, username SSH, dan port SSH dari detail aksesnya. Gunakan detail yang benar dari panel; jangan mengirim password VPS melalui chat.

IP di bawah ditulis `IP_VPS` sebagai placeholder. Ganti dengan IP yang ditampilkan Hostinger. Jika username atau port bukan root/22, sesuaikan perintah.

## 2. Arahkan domain

Pada panel DNS yang mengelola domain:

| Tipe | Nama | Nilai |
| --- | --- | --- |
| A | `@` | IPv4 VPS |
| CNAME | `www` | `tcsmonitor.online` |

Ganti record A untuk nama yang sama jika sebelumnya menunjuk server lain. Record AAAA untuk domain ini perlu menunjuk IPv6 VPS yang benar; jika tidak memakai IPv6, jangan biarkan record AAAA mengarah ke server lama. Tunggu perubahan DNS sampai domain mengarah ke VPS.

## 3. Upload paket dari komputer Windows

Paket `tcsmonitor-site.zip` berisi lima file website dengan struktur yang benar. Jalankan perintah berikut dari PowerShell di folder proyek:

```powershell
scp .\deploy\tcsmonitor-site.zip root@IP_VPS:/tmp/tcsmonitor-site.zip
scp .\deploy\nginx-tcsmonitor.conf root@IP_VPS:/tmp/nginx-tcsmonitor.conf
ssh root@IP_VPS
```

Untuk port SSH yang berbeda, gunakan `scp -P PORT` dan `ssh -p PORT`. Gunakan username sesuai akses VPS.

## 4. Pasang website dan Nginx di VPS

Jalankan di terminal Ubuntu VPS, bukan PowerShell lokal:

```bash
sudo apt update
sudo apt install -y nginx unzip
sudo install -d -m 0755 /var/www/tcsmonitor
sudo unzip -o /tmp/tcsmonitor-site.zip -d /var/www/tcsmonitor
sudo find /var/www/tcsmonitor -type d -exec chmod 755 {} \;
sudo find /var/www/tcsmonitor -type f -exec chmod 644 {} \;
sudo install -m 0644 /tmp/nginx-tcsmonitor.conf /etc/nginx/sites-available/tcsmonitor
```

Aktifkan site jika belum ada symlink-nya:

```bash
sudo ln -s /etc/nginx/sites-available/tcsmonitor /etc/nginx/sites-enabled/tcsmonitor
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

Jika symlink sudah ada dari deployment sebelumnya, lewati perintah `ln -s`. Lanjut reload hanya setelah `nginx -t` berhasil. File konfigurasi ini tidak menghapus atau menonaktifkan site Nginx lainnya.

Jika UFW aktif, izinkan HTTP/HTTPS:

```bash
sudo ufw status
sudo ufw allow 'Nginx Full'
```

Jika firewall Hostinger diaktifkan untuk VPS, izinkan trafik TCP 80 dan 443 di panelnya. Pertahankan akses SSH sesuai port yang digunakan.

Uji dari VPS:

```bash
curl -I -H 'Host: tcsmonitor.online' http://127.0.0.1/
curl -I -H 'Host: tcsmonitor.online' http://127.0.0.1/app.mjs
curl -I -H 'Host: tcsmonitor.online' http://127.0.0.1/supabase/store.mjs
```

Halaman dan module harus memberi HTTP 200. Module `.mjs` harus memiliki `Content-Type: application/javascript`. Tanpa tipe ini, browser bisa menolak module dan dashboard tidak terhubung. URL file SQL atau tests harus memberi 404.

Buka `http://tcsmonitor.online` setelah DNS mengarah ke VPS. IP VPS tanpa nama domain mungkin tetap menampilkan halaman default Nginx, karena konfigurasi ini memilih website berdasarkan hostname domain.

## 5. Aktifkan HTTPS

Jalankan setelah domain `tcsmonitor.online` dan `www.tcsmonitor.online` benar-benar mengarah ke VPS, port 80 bisa diakses, dan Nginx berjalan:

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d tcsmonitor.online -d www.tcsmonitor.online
sudo /snap/bin/certbot renew --dry-run
```

Ikuti pertanyaan Certbot untuk email dan persetujuan sertifikat. Certbot memperbarui konfigurasi Nginx untuk HTTPS. Jika hanya domain utama yang sudah siap, gunakan `-d tcsmonitor.online` dahulu.

## 6. Periksa dashboard

1. Buka `https://tcsmonitor.online`.
2. Pastikan diagram muncul dan form tambah program aktif. Jika koneksi gagal, halaman menampilkan pesan kesalahan lewat popup.
3. Masukkan data program yang memang ingin disimpan, lalu refresh; data harus tetap muncul.
4. Buka dari perangkat/browser lain; data yang sama harus terbaca dari Supabase.

Database Supabase saat penyambungan masih kosong. Data lama dari localStorage belum dimigrasikan dan tidak otomatis dimasukkan ke database.

## Memperbarui website

Paket ZIP merupakan salinan kode saat dibuat. Setelah mengedit kode, buat ulang paket dengan script berikut, lalu upload dan ekstrak ulang seperti langkah 3–4:

```powershell
python .\deploy\package_site.py
```

Tidak perlu menjalankan SQL schema ulang setiap mengubah tampilan website.

Referensi resmi: [Nginx di Ubuntu](https://ubuntu.com/server/docs/how-to/web-services/install-nginx/), [domain ke VPS Hostinger](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/), [Certbot Nginx](https://certbot.eff.org/instructions?ws=nginx&os=snap).

# Supabase untuk dashboard TCS

Mode saat ini mengikuti permintaan: **tanpa login, semua orang dapat melihat dan mengubah data**. Ini juga mencakup menghapus program dan subprogram. Tabel subfungsi hanya dapat dibaca dari web. Saat fitur login ditambahkan, kebijakan akses publik di `schema.sql` harus diganti; menambahkan layar login saja tidak membatasi akses database.

## Struktur data

| Objek | Isi |
| --- | --- |
| `tcs_subfunctions` | Empat subfungsi TCS |
| `tcs_programs` | Nama, subfungsi, target tanggal, keterangan, urutan |
| `tcs_subprograms` | Program induk, nama, subfungsi, bobot, status, target, keterangan, urutan |
| `tcs_program_summary` | Status dan progres program yang dihitung otomatis |
| `tcs_subfunction_summary` | Total subprogram dan jumlah Initiate / On Going / Finish per subfungsi |

Setiap program/subprogram memiliki UUID dan waktu pembuatan/perubahan. Subfungsi induk dan subprogram boleh berbeda. Subfungsi yang belum dipetakan boleh kosong; `legacy_subfunction` menyimpan label lama seperti `C&S` tanpa menebak kategorinya.

Status program: tanpa subprogram atau semua Initiate → Initiate; semua Finish → Finish; kondisi lain → On Going. Progres = jumlah bobot subprogram Finish. Jika total bobot bukan 100%, `weight_valid` bernilai false dan progres NULL; tanpa subprogram progres 0. Total bobot yang belum 100% boleh disimpan sementara agar pengguna bisa mengedit satu baris demi satu baris.

Status/progres program tidak menjadi kolom manual. Progres manual subprogram dan data kuartal tidak dipakai. Menghapus program otomatis menghapus subprogramnya; diagram dihitung dari data yang masih ada.

## Jalankan database

1. Buat project Supabase.
2. Buka **SQL Editor**, buat query baru, tempel seluruh isi `schema.sql`, lalu **Run**.
3. Jalankan `auto-weights.sql` untuk fungsi tambah subprogram dengan bobot otomatis. Fungsi ini dipakai tombol Tambah subprogram pada versi website sekarang.
4. Jalankan `checks.sql` pada query lain. Hasil yang diharapkan: `PASS: CRUD, constraints, status, weighted completion, chart, and cascade deletion`.
5. Periksa tiga tabel dan dua view di Table Editor. Database mulai kosong untuk program/subprogram. Hanya empat subfungsi yang diisi; data contoh tidak ditambahkan kembali.
6. Ambil **Project URL** dan **publishable key** dari panel Connect/API project. Gunakan key browser yang diawali `sb_publishable_...` (atau legacy anon key). **Jangan gunakan secret key / service_role di frontend.**

`schema.sql` dapat dijalankan ulang untuk struktur versi ini; tidak menghapus record program yang sudah ada. Script ini ditujukan untuk project baru atau tabel TCS dari versi yang sama. `checks.sql` memakai transaksi dan ROLLBACK sehingga record pengujian tidak ditinggalkan.

## Koneksi website sudah aktif

`index.html` sekarang memuat `app.mjs` dan `dashboard.mjs`. `app.mjs` memuat library Supabase melalui CDN dan membuat koneksi dari `supabase/config.mjs`. `store.mjs` menangani permintaan baca/tambah/edit/hapus.

Project URL dan publishable key yang diberikan sudah diisi di `config.mjs`. Tidak ada secret/service_role key dalam frontend. Tidak diperlukan Next.js, bundler, atau backend tambahan untuk menjalankan versi ini.

Buka melalui Live Server / localhost atau hosting statis. JavaScript module memerlukan akses HTTP/HTTPS; membuka `index.html` langsung sebagai file lokal bukan cara menjalankan versi ini. Koneksi internet diperlukan untuk database, library Supabase, dan font.

- Data program dan subprogram diambil dari Supabase; tidak ada pembacaan atau penulisan localStorage untuk data bisnis, serta tidak ada SAMPLE otomatis.
- Status/progres utama dan diagram memakai dua view ringkasan database.
- Setiap pengeditan memakai UUID record dan hanya dilaporkan tersimpan setelah request berhasil.
- Jika request gagal, tampil pesan kesalahan. Jika penyimpanan berhasil tetapi pembacaan ulang gagal, tampil pesan yang membedakan kedua keadaan tersebut agar record tidak ditambahkan ulang.
- Buka/tutup subprogram hanya menjadi state tampilan pada tab; tidak mengubah database.
- Tambah subprogram membagi ulang bobot seluruh subprogram program tersebut secara rata, dengan total tepat 100%. Bobot manual sebelumnya ikut diganti. Bobot memakai bilangan bulat; tiga subprogram menjadi 33%, 33%, dan 34%. Bobot pecahan lama dikonversi saat menjalankan auto-weights.sql, dengan mempertahankan total 100% pada data yang sebelumnya valid. Status, target, keterangan dan ID subprogram lama tetap dipertahankan. Progres utama bisa berubah karena bobot tahap Finish ikut dibagi ulang. Edit bobot manual dan peringatan total bukan 100% tetap tersedia; penghapusan subprogram tidak membagi ulang bobot secara otomatis.
- Data diambil otomatis ketika halaman dibuka dan setelah perubahan berhasil disimpan.
- Pengguna lain melihat perubahan ketika membuka atau refresh halaman. Belum ada Realtime/polling otomatis.

## File yang dihosting

Pertahankan struktur berikut:

```text
index.html
app.mjs
dashboard.mjs
supabase/
  config.mjs
  store.mjs
```

File SQL, README, dan tests tidak perlu disajikan ke pengguna website. Key di config adalah publishable key yang memang dipakai di browser.

## Data browser lama

Data lama pada key `pm-dash-v3` tidak dibaca oleh website baru dan tidak dihapus dari browser. Data itu belum diimpor otomatis ke Supabase. Database dapat tampil kosong jika belum ada program yang dimasukkan atau dimigrasikan.

Buka halaman pada origin yang dahulu dipakai mengedit, lalu ambil data lewat Console:

```javascript
const dataLama = JSON.parse(localStorage.getItem('pm-dash-v3') || '[]');
console.log(JSON.stringify(dataLama, null, 2));
```

Data ini bisa dimigrasikan setelah pengguna menentukan bahwa data lama ingin dipertahankan: petakan subfungsi, buat program beserta subprogram dengan relasi UUID, dan periksa hasil impor. Jangan menjalankan localStorage.clear() untuk melakukan migrasi.

## Pemeriksaan pengembangan

```text
npm install
npm test
```

Paket npm hanya diperlukan untuk pemeriksaan pengembangan. Tests menjalankan controller DOM dan adapter di PostgreSQL lokal (PGlite), dengan akses anon, RLS dan constraint yang sama. Data uji tidak dikirim ke project Supabase.

Untuk memeriksa schema langsung di Supabase, jalankan checks.sql. Script memakai transaksi dan ROLLBACK sehingga tidak meninggalkan record percobaan.

Dokumentasi resmi: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [JavaScript client](https://supabase.com/docs/reference/javascript/initializing).
